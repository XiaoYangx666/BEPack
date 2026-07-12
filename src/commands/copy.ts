import { loadConfig } from "../config/loadConfig.js";
import { copyPacks } from "../copy/copyPacks.js";
import { runHook } from "../hooks/runHook.js";
import { Logger } from "../logger/logger.js";

export async function commandCopy(options: any) {
    const start = Date.now();
    const logger = new Logger({ ...options, silent: options.silent || options.json });
    const { cwd, config } = await loadConfig({
        cwd: options.cwd ?? process.cwd(),
        configPath: options.config,
    });
    await runHook("beforeCopy", "copy", cwd, config, logger);
    const targets = options.all
        ? ["win", "winold", ...Object.keys(config.copy.targets)]
        : [options.target ?? config.copy.defaultTarget];
    const results = [];
    for (const target of targets)
        results.push(await copyPacks(cwd, config, target, options.dryRun, logger));
    await runHook("afterCopy", "copy", cwd, config, logger);
    const durationMs = Date.now() - start;
    logger.done(
        "copy",
        `${options.dryRun ? "dry-run complete" : "complete"} in ${logger.formatDuration(durationMs)}`
    );
    return { ok: true, command: "copy", durationMs, results };
}
