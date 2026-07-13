import { loadConfig } from "../config/loadConfig.js";
import { Logger } from "../logger/logger.js";

/**
 * Safer serialization using a recursion depth tracker.
 * Uses a stack to detect when we encounter the same object again during
 * a depth-first traversal branch — that's a genuine cycle.
 * Shared references (same object via different branches) are not cycles.
 */
function safeSerialize(value: unknown): unknown {
    const seen = new WeakSet<object>();
    const stack: object[] = [];

    function recurse(v: unknown): unknown {
        if (typeof v === "function") return "[function]";
        if (v instanceof RegExp) return v.toString();
        if (v === null || v === undefined || typeof v !== "object") return v;

        // Check if this exact object is currently in our recursion stack
        if (stack.includes(v)) return "[circular]";

        // Check if we've seen this object before (shared reference, not a cycle)
        if (seen.has(v)) return "[shared]";

        seen.add(v);

        if (Array.isArray(v)) {
            stack.push(v);
            const result = v.map((item) => {
                const val = recurse(item);
                return val;
            });
            stack.pop();
            return result;
        }

        // Plain object
        const obj = v as Record<string, unknown>;
        const keys = Object.keys(obj);
        stack.push(v);
        const result: Record<string, unknown> = {};
        for (const key of keys) {
            result[key] = recurse(obj[key]);
        }
        stack.pop();
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
