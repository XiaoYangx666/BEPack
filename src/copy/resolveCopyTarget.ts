import path from "node:path";
import os from "node:os";
import type { CopyTarget, CopyTargetCustom, CopyTargetGameRoot, CopyTargetNames, ResolvedConfig } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";

/**
 * Built-in game-root targets.
 * Each entry is a lazy factory — paths are computed only when the target is used.
 */
const BUILTINS: Record<string, () => CopyTargetGameRoot> = {
    win: () => ({
        type: "gameRoot",
        path: path.join(
            "C:/Users",
            os.userInfo().username,
            "AppData/Roaming/Minecraft Bedrock/Users/Shared/games/com.mojang"
        ),
    }),
    winold: () => {
        const local = process.env.LOCALAPPDATA;
        if (!local) {
            throw new BePackError(
                "COPY_TARGET_NOT_FOUND",
                "%LOCALAPPDATA% is required for winold copy target."
            );
        }
        return {
            type: "gameRoot",
            path: path.join(
                local,
                "Packages",
                "Microsoft.MinecraftUWP_8wekyb3d8bbwe",
                "LocalState",
                "games",
                "com.mojang"
            ),
        };
    },
};

/**
 * Convert a `gameRoot` target to concrete `custom` paths.
 * Only sets `rp` when the project has a resource pack configured.
 */
function resolveGameRoot(
    config: ResolvedConfig,
    target: CopyTargetGameRoot
): CopyTargetCustom {
    return {
        type: "custom" as const,
        bp: path.join(target.path, "development_behavior_packs"),
        ...(config.packs.rp ? { rp: path.join(target.path, "development_resource_packs") } : {}),
    };
}

export function resolveCopyTarget(
    config: ResolvedConfig,
    name?: string
): { name: string; target: CopyTargetCustom; names: CopyTargetNames } {
    const targetName = name ?? config.copy.defaultTarget;

    if (!targetName) {
        throw new BePackError(
            "COPY_TARGET_NOT_FOUND",
            "No copy target configured. Set copy.defaultTarget or copy.targets in bepack.config.ts, or pass --target.",
            {
                suggestions: [
                    "Add copy.defaultTarget to your config file.",
                    "Or set build.copy / dev.copy to a target name instead of true.",
                    "Built-in targets: win, winold.",
                ],
            }
        );
    }

    // Unified lookup: user-defined targets override built-in names
    const raw: CopyTarget | undefined =
        config.copy.targets[targetName] ?? BUILTINS[targetName]?.();

    if (!raw) {
        throw new BePackError("COPY_TARGET_NOT_FOUND", `Copy target not found: ${targetName}`, {
            details: { target: targetName },
        });
    }

    // Resolve folder names: per-target > global copy > fallback (handled in copyPacks)
    const userEntry = config.copy.targets[targetName] as
        | (CopyTarget & { name?: string | CopyTargetNames })
        | undefined;
    const perTargetName = userEntry?.name;
    const globalName = config.copy.name;

    // Helper: normalize string → { bp, rp }
    const resolveName = (v: string | CopyTargetNames | undefined): CopyTargetNames =>
        typeof v === "string" ? { bp: v, rp: v } : v ?? {};

    const perTarget = resolveName(perTargetName);
    const global = resolveName(globalName);

    const names: CopyTargetNames = {};
    const bpName = perTarget.bp ?? global.bp;
    const rpName = perTarget.rp ?? global.rp;
    if (bpName) names.bp = bpName;
    if (rpName) names.rp = rpName;

    // Resolve gameRoot targets (both built-in and user-defined) to concrete paths
    if (raw.type === "gameRoot") {
        return { name: targetName, target: resolveGameRoot(config, raw), names };
    }

    return { name: targetName, target: raw, names };
}
