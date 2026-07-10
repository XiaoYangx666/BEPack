import type { CommandName, ResolvedConfig } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import type { Logger } from "../logger/logger.js";
import {
    bpManifest,
    bpRoot,
    distRoot,
    rpManifest,
    rpRoot,
    scriptOutFile,
    srcEntry,
} from "../utils/path.js";

function formatHookResult(result: unknown): string {
    if (result === undefined || result === null || result === "") return "hook ran";
    if (typeof result === "string") return result;
    if (typeof result === "number" || typeof result === "boolean") return String(result);
    try {
        return JSON.stringify(result);
    } catch {
        return String(result);
    }
}

function resolvePaths(cwd: string, config: ResolvedConfig) {
    return {
        srcEntry: srcEntry(cwd, config),
        bpRoot: bpRoot(cwd, config),
        ...(config.packs.rp ? { rpRoot: rpRoot(cwd, config) } : {}),
        scriptOutFile: scriptOutFile(cwd, config),
        bpManifest: bpManifest(cwd, config),
        ...(config.packs.rp ? { rpManifest: rpManifest(cwd, config) } : {}),
        dist: distRoot(cwd, config),
    };
}

export async function runHook(
    name: keyof ResolvedConfig["hooks"],
    command: CommandName,
    cwd: string,
    config: ResolvedConfig,
    logger: Logger
): Promise<void> {
    const hook = config.hooks[name];
    if (!hook) return;
    try {
        const result = await hook({
            command,
            cwd,
            target: config.target,
            config,
            paths: resolvePaths(cwd, config),
            logger,
        });
        logger.hook(String(name), formatHookResult(result));
    } catch (cause) {
        throw new BePackError(
            "HOOK_FAILED",
            `${String(name)} hook failed: ${cause instanceof Error ? cause.message : String(cause)}`
        );
    }
}
