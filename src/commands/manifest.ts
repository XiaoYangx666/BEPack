import { loadConfig } from "../config/loadConfig.js";
import { patchManifest } from "../manifest/patchManifest.js";
import { runHook } from "../hooks/runHook.js";
import { Logger } from "../logger/logger.js";

export async function commandManifest(options: any) {
    const logger = new Logger({ ...options, silent: options.silent || options.json });
    const { cwd, config } = await loadConfig({
        command: "manifest",
        cwd: options.cwd ?? process.cwd(),
        configPath: options.config,
        overrides: { target: options.target },
    });
    await runHook("beforeManifest", "manifest", cwd, config, logger);
    const files = await patchManifest({ cwd, config, dryRun: options.dryRun, logger });
    await runHook("afterManifest", "manifest", cwd, config, logger);
    logger.success("Manifest", options.dryRun ? "dry-run complete" : "updated manifest.json");
    return { ok: true, command: "manifest", target: config.target, files };
}
