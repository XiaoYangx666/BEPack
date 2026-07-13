import path from "node:path";
import { loadConfig } from "../config/loadConfig.js";
import { runBuild } from "../build/runBuild.js";
import { copyPacks } from "../copy/copyPacks.js";
import { watchProject } from "../dev/watch.js";
import { Logger } from "../logger/logger.js";

export async function commandDev(options: any) {
    const start = Date.now();
    const logger = new Logger({ ...options, silent: options.silent || options.json });
    const { cwd, config } = await loadConfig({
        cwd: options.cwd ?? process.cwd(),
        configPath: options.config,
        overrides: {
            ...(options.timing !== undefined ? { build: { timing: options.timing } } : {}),
        },
    });
    logger.clear();
    logger.bepack("dev", `target ${config.target}`);
    logger.progress("dev", "initial build started");

    // Resolve CLI overrides once and keep them for the entire dev session.
    const compile = config.packs.bp?.compile;
    const typecheck = options.skipTypecheck
        ? false
        : options.typecheck
          ? true
          : (compile?.typecheck ?? false);
    const copy =
        !options.skipCopy && Boolean(options.copy || options.copyTarget || config.dev.copy);
    const copyTarget =
        options.copyTarget ?? (typeof config.dev.copy === "string" ? config.dev.copy : undefined);
    const cache = compile?.cache.dev ?? true;
    const dryRun = Boolean(options.dryRun);
    const quiet = Boolean(options.json || options.silent);

    // Initial build: let TypeScript manage cache freshness.
    // Do not delete .tsbuildinfo — that would defeat incremental caching.
    await runBuild({
        cwd,
        config,
        logger,
        mode: options.mode,
        typecheck: Boolean(typecheck),
        cache,
        dryRun,
        quiet,
    });

    // Initial copy (if configured)
    if (copy) {
        await copyPacks(cwd, config, copyTarget, dryRun, logger);
    }

    logger.done("dev", `initial build complete in ${logger.formatDuration(Date.now() - start)}`);
    watchProject(cwd, config, logger, {
        copy,
        mode: options.mode,
        ...(copyTarget ? { copyTarget } : {}),
        typecheck: Boolean(typecheck),
        cache,
        dryRun,
        quiet,
    });
    return { ok: true, command: "dev", initialBuildDurationMs: Date.now() - start };
}
