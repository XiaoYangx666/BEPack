import path from "node:path";
import type { ResolvedConfig } from "../config/configTypes.js";
import { copyDir } from "../utils/fs.js";
import { bpRoot, rpRoot } from "../utils/path.js";
import { resolveCopyTarget } from "./resolveCopyTarget.js";
import type { Logger } from "../logger/logger.js";
import pc from "picocolors";

const colors = pc.createColors(
    process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== "0"
);

export async function copyPacks(
    cwd: string,
    config: ResolvedConfig,
    targetName?: string,
    dryRun = false,
    logger?: Logger
) {
    const { name, target } = resolveCopyTarget(config, targetName);
    const copied: string[] = [];
    if (target.bp) {
        const to = path.join(target.bp, config.packs.bp.name);
        if (!dryRun) await copyDir(bpRoot(cwd, config), to);
        logger?.copy(`${dryRun ? "would copy" : "copied"} bp -> ${colors.gray(to)}`);
        copied.push(to);
    }
    if (config.packs.rp && target.rp) {
        const to = path.join(target.rp, config.packs.rp.name);
        if (!dryRun) await copyDir(rpRoot(cwd, config), to);
        logger?.copy(`${dryRun ? "would copy" : "copied"} rp -> ${colors.gray(to)}`);
        copied.push(to);
    }
    return { target: name, copied };
}
