import { copyPacks } from "./copyPacks.js";
import { runHook } from "../hooks/runHook.js";
import type { CommandName, ResolvedConfig } from "../config/configTypes.js";
import type { Logger } from "../logger/logger.js";

export type RunCopyOptions = {
    /** Command reported to the hooks (`"build"`, `"dev"`, ...). */
    command: CommandName;
    cwd: string;
    config: ResolvedConfig;
    logger: Logger;
    targetName?: string | undefined;
    dryRun?: boolean;
    mode?: string;
    /** CLI `--optimize` override for the copied dev folder. */
    optimize?: boolean;
};

/**
 * Copy packs with `beforeCopy` / `afterCopy` around the copy.
 *
 * Used by `build --copy` and by `dev` (initial copy and every rebuild), so the copy
 * hooks fire for automatic copies too — not only for the standalone `copy` command.
 */
export async function runCopyPacks(options: RunCopyOptions) {
    const { command, cwd, config, logger, targetName, mode, optimize } = options;
    const dryRun = Boolean(options.dryRun);
    const hookOptions = { ...(mode === undefined ? {} : { mode }), dryRun };
    await runHook("beforeCopy", command, cwd, config, logger, hookOptions);
    const result = await copyPacks(
        cwd,
        config,
        targetName,
        dryRun,
        logger,
        optimize === undefined ? {} : { optimize }
    );
    await runHook("afterCopy", command, cwd, config, logger, hookOptions);
    return result;
}
