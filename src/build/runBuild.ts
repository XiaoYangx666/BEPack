import path from "node:path";
import type { ResolvedConfig, TypecheckCommandSetting } from "../config/configTypes.js";
import { runManifestPatch } from "../manifest/runManifest.js";
import { runTypecheck } from "./runTypecheck.js";
import { runRolldown } from "./runRolldown.js";
import { runHook } from "../hooks/runHook.js";
import type { Logger } from "../logger/logger.js";
import { projectRoot, slash, hasBpCompile, scriptOutFile } from "../utils/path.js";

export type RunBuildOptions = {
    cwd: string;
    config: ResolvedConfig;
    logger: Logger;
    /** Execution mode passed to hooks. */
    mode?: string;
    /** Command running this build; exposed to rolldown customization functions. */
    command?: "build" | "dev";
    /** CLI `--rolldown-config` path, overriding `packs.bp.compile.rolldownConfig`. */
    rolldownConfig?: string;
    /** Force typecheck (overrides config). Default: config.packs.bp.compile.typecheck */
    typecheck?: boolean;
    /**
     * CLI `--typecheck-command <command>` override. Replaces the configured command *and*
     * its args: args are usually checker-specific, so carrying them over would silently
     * misconfigure the command the user just asked for.
     */
    typecheckCommand?: TypecheckCommandSetting;
    /** @deprecated CLI compatibility for `--use-npx`; retains default tsconfig/cache flags. */
    useNpx?: boolean;
    /** Enable TypeScript incremental compilation cache. */
    cache?: boolean;
    dryRun?: boolean;
    quiet?: boolean;
    resolvedDeps?: Record<string, string>;
};

async function timed<T>(
    label: string,
    fn: () => Promise<T>,
    logger: Logger,
    timing: boolean
): Promise<T> {
    const start = timing ? Date.now() : 0;
    const result = await fn();
    if (timing) logger.timing(label, Date.now() - start);
    return result;
}

export async function runBuild(options: RunBuildOptions) {
    const start = Date.now();
    const timing = options.config.build.timing;
    const root = projectRoot(options.cwd, options.config);
    const compile = hasBpCompile(options.config);
    const command = options.command ?? "build";
    const hookOptions = {
        ...(options.mode === undefined ? {} : { mode: options.mode }),
        dryRun: Boolean(options.dryRun),
    };

    // Phase 1: Manifest patching (for all configured packs)
    await timed(
        "manifest",
        () =>
            runManifestPatch({
                cwd: options.cwd,
                config: options.config,
                command,
                logger: options.logger,
                dryRun: Boolean(options.dryRun),
                ...(options.mode === undefined ? {} : { mode: options.mode }),
                ...(options.resolvedDeps ? { resolvedDeps: options.resolvedDeps } : {}),
            }),
        options.logger,
        timing
    );
    const patchedPacks: string[] = [];
    if (options.config.packs.bp) patchedPacks.push("bp");
    if (options.config.packs.rp) patchedPacks.push("rp");
    options.logger.manifest(`manifest.json updated (${patchedPacks.join(", ")})`);

    // Phase 2: Compilation (only when BP has compile config)
    await runHook("beforeBuild", command, options.cwd, options.config, options.logger, hookOptions);

    let typecheckRan = false;
    let typecheckCommandUsed: string | undefined;
    if (compile && !options.dryRun && options.typecheck !== false) {
        const compileConfig = options.config.packs.bp!.compile!;
        const tsBuildInfoFile = options.cache
            ? path.resolve(root, compileConfig.cache.file)
            : undefined;
        // CLI --typecheck-command wins; then CLI --use-npx; then configured command;
        // then deprecated config.useNpx; otherwise runTypecheck applies the default.
        const command =
            options.typecheckCommand ??
            (options.useNpx ? undefined : compileConfig.typecheckCommand);
        const useNpx =
            options.typecheckCommand === undefined &&
            (Boolean(options.useNpx) || (command === undefined && compileConfig.useNpx));
        const result = await timed(
            "typecheck",
            () =>
                runTypecheck(root, {
                    quiet: Boolean(options.quiet),
                    ...(command === undefined ? {} : { command }),
                    useNpx,
                    // A CLI command replaces the configured args along with the command.
                    args:
                        options.typecheckCommand !== undefined || options.useNpx
                            ? []
                            : compileConfig.typecheckArgs,
                    tsconfigPath: compileConfig.tsconfig,
                    incremental: Boolean(options.cache),
                    ...(tsBuildInfoFile ? { tsBuildInfoFile } : {}),
                    warn: (message) => options.logger.warn(message),
                }),
            options.logger,
            timing
        );
        typecheckRan = true;
        typecheckCommandUsed = result.commandLine;
        options.logger.typescript(`typecheck complete (${result.commandLine})`);
    }

    if (compile && !options.dryRun) {
        await timed(
            "rolldown",
            () =>
                runRolldown(options.cwd, options.config, options.logger, {
                    ...(options.command !== undefined ? { command: options.command } : {}),
                    ...(options.mode !== undefined ? { mode: options.mode } : {}),
                    ...(options.rolldownConfig !== undefined
                        ? { rolldownConfig: options.rolldownConfig }
                        : {}),
                }),
            options.logger,
            timing
        );
        options.logger.rolldown(
            options.config.packs.bp!.compile!.preserveModules
                ? "preserve modules build complete"
                : "bundle complete"
        );
    }

    await runHook("afterBuild", command, options.cwd, options.config, options.logger, hookOptions);
    const durationMs = Date.now() - start;
    return {
        script: compile ? slash(scriptOutFile(options.cwd, options.config)!) : undefined,
        compiled: compile,
        typecheck: typecheckRan,
        ...(typecheckCommandUsed ? { typecheckCommand: typecheckCommandUsed } : {}),
        durationMs,
    };
}
