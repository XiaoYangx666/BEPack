import { loadConfig } from "../config/loadConfig.js";
import { runBuild } from "../build/runBuild.js";
import { copyPacks } from "../copy/copyPacks.js";
import { runPack } from "./pack.js";
import { commandInstall } from "./install.js";
import { Logger } from "../logger/logger.js";
import { BePackError } from "../errors/BePackError.js";

function assertNoConflicts(options: any): void {
    const pairs = [
        ["copy", "skipCopy"],
        ["pack", "skipPack"],
        ["typecheck", "skipTypecheck"],
        ["install", "skipInstall"],
    ];
    for (const pair of pairs) {
        const [a, b] = pair as [string, string];
        if (options[a] && options[b])
            throw new BePackError(
                "CLI_ARGUMENT_CONFLICT",
                `--${a} and --${b} cannot be used together.`
            );
    }
}

export async function commandBuild(options: any) {
    assertNoConflicts(options);
    const logger = new Logger({ ...options, silent: options.silent || options.json });
    const { cwd, config } = await loadConfig({
        cwd: options.cwd ?? process.cwd(),
        configPath: options.config,
        overrides: {
            target: options.target,
            ...(options.timing !== undefined ? { build: { timing: options.timing } } : {}),
        },
    });
    logger.bepack("build", `target ${config.target}`);
    let resolvedDeps: Record<string, string> | undefined;
    if (options.install) {
        const install = await commandInstall({
            ...options,
            cwd,
            config: undefined,
            silent: options.silent || options.json,
        });
        resolvedDeps = Object.fromEntries(
            Object.entries(install.resolved)
                .filter(([, dep]) => dep.manifestVersion !== null)
                .map(([name, dep]) => [name, dep.manifestVersion as string])
        );
    }

    // Typecheck override: CLI --skip-typecheck / --typecheck > config
    const compile = config.packs.bp?.compile;
    const typecheck = options.skipTypecheck
        ? false
        : options.typecheck
          ? true
          : compile?.typecheck ?? false;

    // Cache override: CLI --cache/--no-cache > config.cache.build > false
    const cache = options.cache ?? (compile?.cache.build ?? false);

    const build = await runBuild({
        cwd,
        config,
        logger,
        mode: options.mode,
        typecheck: Boolean(typecheck),
        cache: Boolean(cache),
        dryRun: Boolean(options.dryRun),
        quiet: Boolean(options.json || options.silent),
        ...(resolvedDeps ? { resolvedDeps } : {}),
    });

    let copy = null;
    const shouldCopy = options.skipCopy
        ? false
        : options.copy || options.copyTarget
          ? true
          : config.build.copy;
    if (shouldCopy)
        copy = await copyPacks(
            cwd,
            config,
            options.copyTarget ?? (typeof shouldCopy === "string" ? shouldCopy : undefined),
            options.dryRun,
            logger
        );
    let packResult = null;
    if (!options.skipPack && options.pack)
        packResult = await runPack(cwd, config, logger, { name: options.name, dryRun: options.dryRun });
    logger.done("build", `complete in ${logger.formatDuration(build.durationMs)}`);
    return { ok: true, command: "build", durationMs: build.durationMs, build, copy, pack: packResult };
}
