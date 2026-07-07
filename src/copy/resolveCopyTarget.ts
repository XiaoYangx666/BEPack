import type { ResolvedConfig } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { getWinOldTarget, getWinTarget } from "./winTarget.js";

export function resolveCopyTarget(config: ResolvedConfig, name?: string) {
    const targetName = name ?? config.copy.defaultTarget;
    if (targetName === "win") return { name: "win", target: getWinTarget() };
    if (targetName === "winold") return { name: "winold", target: getWinOldTarget() };
    const target = config.copy.targets[targetName];
    if (!target) throw new BePackError("COPY_TARGET_NOT_FOUND", `Copy target not found: ${targetName}`, { details: { target: targetName } });
    return { name: targetName, target };
}
