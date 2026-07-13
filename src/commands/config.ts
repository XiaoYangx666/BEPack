import { loadConfig } from "../config/loadConfig.js";
import { Logger } from "../logger/logger.js";

/**
 * Safer serialization using a recursion depth tracker.
 * Uses a stack to detect when we encounter the same object again during
 * a depth-first traversal branch — that's a genuine cycle.
 * Shared references (same object via different branches) are not cycles.
 */
export function safeSerialize(value: unknown): unknown {
    const active = new WeakSet<object>();

    function recurse(v: unknown): unknown {
        if (typeof v === "function") return "[function]";
        if (v instanceof RegExp) return v.toString();
        if (v === null || v === undefined || typeof v !== "object") return v;
        if (active.has(v)) return "[circular]";

        active.add(v);
        const result = Array.isArray(v)
            ? v.map(recurse)
            : Object.fromEntries(
                  Object.entries(v as Record<string, unknown>).map(([key, item]) => [
                      key,
                      recurse(item),
                  ])
              );
        active.delete(v);
        return result;
    }

    return recurse(value);
}

export async function commandConfig(options: any) {
    const logger = new Logger({ ...options, silent: options.silent || options.json });
    const {
        cwd,
        config,
        path: configFile,
    } = await loadConfig({
        cwd: options.cwd ?? process.cwd(),
        configPath: options.config,
    });

    if (options.json) {
        return { cwd, configFile, config: safeSerialize(config) };
    }

    if (options.summary) {
        // Summary mode: show selected fields
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

        if (config.copy.defaultTarget)
            logger.info(`copy.defaultTarget: ${config.copy.defaultTarget}`);
        if (config.build.copy) logger.info(`build.copy: ${config.build.copy}`);
        if (config.dev.copy) logger.info(`dev.copy: ${config.dev.copy}`);

        return { ok: true, command: "config" };
    }

    // Full config output using JSON.stringify for readability
    const serialized = safeSerialize(config);
    const output = JSON.stringify(serialized, null, 2);

    logger.bepack("config", configFile);
    logger.info(`cwd: ${cwd}`);
    logger.info(`configFile: ${configFile}`);
    logger.info("");
    logger.info(output);

    return { ok: true, command: "config" };
}
