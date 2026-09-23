import { loadConfig } from "../config/loadConfig.js";
import { runManifestPatch } from "../manifest/runManifest.js";
import { Logger } from "../logger/logger.js";

export async function commandManifest(options: any) {
    const logger = new Logger({ ...options, silent: options.silent || options.json });
    const { cwd, config } = await loadConfig({
        cwd: options.cwd ?? process.cwd(),
        configPath: options.config,
        overrides: { target: options.target },
    });
    const files = await runManifestPatch({
        cwd,
        config,
        command: "manifest",
        dryRun: options.dryRun,
        logger,
    });
    logger.success("Manifest", options.dryRun ? "dry-run complete" : "updated manifest.json");
    return { ok: true, command: "manifest", target: config.target, files };
}
