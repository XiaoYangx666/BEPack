import { FIXED_PATHS } from "../constants/paths.js";
import type { CommandName, ResolvedConfig } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import type { Logger } from "../logger/logger.js";

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
            paths: FIXED_PATHS,
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
