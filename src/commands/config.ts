import { loadConfig } from "../config/loadConfig.js";
import type { ResolvedConfig } from "../config/configTypes.js";
import { Logger } from "../logger/logger.js";

/**
 * Serialize a ResolvedConfig into a JSON-safe object, replacing
 * non-serializable fields (hooks, RegExp) with their string forms.
 */
function serializeConfig(config: ResolvedConfig): Record<string, unknown> {
    const seen = new WeakSet();
    return JSON.parse(
        JSON.stringify(config, (_key, value) => {
            if (typeof value === "function") return "[function]";
            if (value instanceof RegExp) return value.toString();
            if (value !== null && typeof value === "object") {
                if (seen.has(value)) return "[circular]";
                seen.add(value);
            }
            return value;
        })
    ) as Record<string, unknown>;
}

export async function commandConfig(options: any) {
    const logger = new Logger({ ...options, silent: options.silent || options.json });
    const { cwd, config, path: configFile } = await loadConfig({
        cwd: options.cwd ?? process.cwd(),
        configPath: options.config,
    });

    if (options.json) {
        return { cwd, configFile, config: serializeConfig(config) };
    }

    // Summary output
    logger.bepack("config", configFile);
    logger.info(`root: ${config.root}`);
    logger.info(`name: ${config.name}`);
    logger.info(`version: ${config.version}`);
    if (config.description) logger.info(`description: ${config.description}`);
    logger.info(`target: ${config.target}`);

    const packs = [];
    if (config.packs.bp) packs.push("bp");
    if (config.packs.rp) packs.push("rp");
    logger.info(`packs: ${packs.join(", ")}`);

    if (config.packs.bp?.compile) {
        const c = config.packs.bp.compile;
        logger.info(`compile.entry: ${c.entry}`);
        logger.info(`compile.scriptOutputDir: ${c.scriptOutputDir}`);
        logger.info(`compile.preserveModules: ${c.preserveModules}`);
        logger.info(`compile.typecheck: ${c.typecheck}`);
        if (c.external.length > 0) {
            logger.info(
                `compile.external: [${c.external.map((e) => (typeof e === "string" ? e : e.toString())).join(", ")}]`
            );
        }
    }

    const hookNames = Object.keys(config.hooks);
    if (hookNames.length > 0) logger.info(`hooks: ${hookNames.join(", ")}`);
    else logger.info("hooks: (none)");

    logger.info(`install.registry: ${config.install.registry}`);
    logger.info(`pack.outDir: ${config.pack.outDir}`);

    if (config.copy.defaultTarget) logger.info(`copy.defaultTarget: ${config.copy.defaultTarget}`);
    if (config.build.copy) logger.info(`build.copy: ${config.build.copy}`);
    if (config.dev.copy) logger.info(`dev.copy: ${config.dev.copy}`);

    return { ok: true, command: "config" };
}
