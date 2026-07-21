import path from "node:path";
import type { ResolvedConfig } from "../config/configTypes.js";
import { patchManifest } from "../manifest/patchManifest.js";
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
    /** Force typecheck (overrides config). Default: config.packs.bp.compile.typecheck */
    typecheck?: boolean;
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

    // Phase 1: Manifest patching (for all configured packs)
    await timed(
        "manifest",
        () =>
            patchManifest({
                cwd: options.cwd,
                config: options.config,
                dryRun: Boolean(options.dryRun),
                logger: options.logger,
                ...(options.resolvedDeps ? { resolvedDeps: options.resolvedDeps } : {}),
            }),
        options.logger,
        timing
    );
    const patchedPacks: string[] = [];
    if (options.config.packs.bp) patchedPacks.push("bp");
    if (options.config.packs.rp) patchedPacks.push("rp");
    options.logger.manifest(
        `manifest.json updated (${patchedPacks.join(", ")})`
    );

    // Phase 2: Compilation (only when BP has compile config)
    await runHook("beforeBuild", "build", options.cwd, options.config, options.logger, options.mode);

    let typecheckRan = false;
    if (compile && !options.dryRun && options.typecheck !== false) {
        const compileConfig = options.config.packs.bp!.compile!;
        const tsBuildInfoFile = options.cache
            ? path.resolve(root, compileConfig.cache.file)
            : undefined;
        await timed(
            "typecheck",
            () =>
                runTypecheck(root, {
                    quiet: Boolean(options.quiet),
                    useNpx: compileConfig.useNpx,
                    tsconfigPath: compileConfig.tsconfig,
                    incremental: Boolean(options.cache),
                    ...(tsBuildInfoFile ? { tsBuildInfoFile } : {}),
                }),
            options.logger,
            timing
        );
        typecheckRan = true;
        options.logger.typescript("typecheck complete");
    }

    if (compile && !options.dryRun) {
        await timed(
            "rolldown",
            () => runRolldown(options.cwd, options.config, options.logger),
            options.logger,
            timing
        );
        options.logger.rolldown(
            options.config.packs.bp!.compile!.preserveModules
                ? "preserve modules build complete"
                : "bundle complete"
        );
    }

    await runHook("afterBuild", "build", options.cwd, options.config, options.logger, options.mode);
    const durationMs = Date.now() - start;
    return {
        script: compile
            ? slash(scriptOutFile(options.cwd, options.config)!)
            : undefined,
        compiled: compile,
        typecheck: typecheckRan,
        durationMs,
    };
}
