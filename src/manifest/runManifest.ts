import { patchManifest } from "./patchManifest.js";
import type { PatchManifestOptions } from "./patchManifest.js";
import { runHook } from "../hooks/runHook.js";
import type { CommandName } from "../config/configTypes.js";
import type { Logger } from "../logger/logger.js";

export type RunManifestOptions = Omit<PatchManifestOptions, "logger"> & {
    /** Command reported to the hooks (`"manifest"`, `"build"`, `"dev"`, ...). */
    command: CommandName;
    logger: Logger;
    /** CLI `--mode` value forwarded to the hooks. */
    mode?: string;
};

/**
 * Patch manifests with `beforeManifest` / `afterManifest` around the patch.
 *
 * Every command that rewrites manifests (`manifest`, `build`, `dev`, `pack`) goes
 * through this wrapper, so those hooks fire consistently instead of only for the
 * standalone `manifest` command.
 */
export async function runManifestPatch(options: RunManifestOptions) {
    const { command, logger, mode, ...patch } = options;
    const hookOptions = { ...(mode === undefined ? {} : { mode }), dryRun: Boolean(patch.dryRun) };
    await runHook("beforeManifest", command, patch.cwd, patch.config, logger, hookOptions);
    const files = await patchManifest({ ...patch, logger });
    await runHook("afterManifest", command, patch.cwd, patch.config, logger, hookOptions);
    return files;
}
