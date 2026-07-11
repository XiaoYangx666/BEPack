import type { CommandName, ResolvedConfig, HookContext } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import type { Logger } from "../logger/logger.js";
import {
    bpManifest,
    bpRoot,
    distRoot,
    hasBpCompile,
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

function resolvePaths(cwd: string, config: ResolvedConfig): HookContext["paths"] {
    const paths: HookContext["paths"] = {
        dist: distRoot(cwd, config),
    };
    if (config.packs.bp) {
        paths.bpRoot = bpRoot(cwd, config);
        paths.bpManifest = bpManifest(cwd, config)!;
        if (hasBpCompile(config)) {
            const entry = srcEntry(cwd, config);
            if (entry) paths.srcEntry = entry;
            const scriptFile = scriptOutFile(cwd, config);
            if (scriptFile) paths.scriptOutFile = scriptFile;
        }
    }
    if (config.packs.rp) {
        paths.rpRoot = rpRoot(cwd, config);
        paths.rpManifest = rpManifest(cwd, config)!;
    }
    return paths;
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
