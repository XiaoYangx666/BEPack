import { loadConfig } from "../config/loadConfig.js";
import { runBuild } from "../build/runBuild.js";
import { copyPacks } from "../copy/copyPacks.js";
import { watchProject } from "../dev/watch.js";
import { Logger } from "../logger/logger.js";

export async function commandDev(options: any) {
    const start = Date.now();
    const logger = new Logger({ ...options, silent: options.silent || options.json });
    const { cwd, config } = await loadConfig({
        command: "dev",
        cwd: options.cwd ?? process.cwd(),
        configPath: options.config,
        overrides: {
            ...(options.timing !== undefined
                ? { build: { timing: options.timing } }
                : {}),
        },
    });
    logger.clear();
    logger.bepack("dev", `target ${config.target}`);
    logger.progress("dev", "initial build started");
    await runBuild({
        cwd,
        config,
        logger,
        typecheck: config.build.typecheck,
        quiet: Boolean(options.json || options.silent),
    });
    if (!options.skipCopy && (options.copy || options.copyTarget || config.dev.copy)) {
        const target =
            options.copyTarget ??
            (typeof config.dev.copy === "string" ? config.dev.copy : undefined);
        await copyPacks(cwd, config, target, false, logger);
    }
    logger.done("dev", `initial build complete in ${logger.formatDuration(Date.now() - start)}`);
    watchProject(cwd, config, logger, options.copyTarget);
    return { ok: true, command: "dev", initialBuildDurationMs: Date.now() - start };
}
