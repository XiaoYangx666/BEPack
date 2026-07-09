import path from "node:path";
import { promises as fs } from "node:fs";
import type { ResolvedConfig } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { copyDir, pathExists } from "../utils/fs.js";
import { bpRoot, rpRoot } from "../utils/path.js";
import { resolveCopyTarget } from "./resolveCopyTarget.js";
import type { Logger } from "../logger/logger.js";
import pc from "picocolors";

const colors = pc.createColors(
    process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== "0"
);

/** Default files/folders included when copying a behavior pack. */
const DEFAULT_BP_INCLUDES = [
    "scripts",
    "manifest.json",
    "animation_controllers",
    "animations",
    "biomes",
    "blocks",
    "entities",
    "functions",
    "items",
    "loot_tables",
    "pack_icon.png",
    "recipes",
    "spawn_rules",
    "structures",
    "texts",
    "trading",
    "feature_rules",
    "features",
    "worldgen",
];

/** Default files/folders included when copying a resource pack. */
const DEFAULT_RP_INCLUDES: string[] = [];

/**
 * Merge default includes with user-configured additions.
 * DEFAULT_RP_INCLUDES is empty — when the merged list is also empty,
 * the full directory is copied for backward compatibility.
 */
function getIncludes(
    defaults: string[],
    userAdditions: string[] | undefined
): string[] {
    return userAdditions?.length ? [...defaults, ...userAdditions] : defaults;
}

/**
 * Copy specific items from source to target directory.
 * Target is removed first, then recreated, then each item is copied.
 * Missing source items are silently skipped.
 */
async function copySelectedItems(
    source: string,
    target: string,
    items: string[]
): Promise<void> {
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(target, { recursive: true });

    for (const item of items) {
        const src = path.join(source, item);
        const dst = path.join(target, item);
        try {
            await fs.cp(src, dst, { recursive: true });
        } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
        }
    }
}

async function validateTargetDir(dir: string, label: string): Promise<void> {
    if (!(await pathExists(dir))) {
        throw new BePackError("COPY_FAILED", `Copy target directory does not exist: ${dir}`, {
            details: { dir, label },
            suggestions: [
                `Create the target directory: mkdir -p "${dir}"`,
                `Or check the copy target path in bepack.config.ts.`,
            ],
        });
    }
}

export async function copyPacks(
    cwd: string,
    config: ResolvedConfig,
    targetName?: string,
    dryRun = false,
    logger?: Logger
) {
    const { name: targetNameResolved, target, names } = resolveCopyTarget(config, targetName);
    const copied: string[] = [];

    // Validate target directories exist before copying
    if (target.bp) {
        await validateTargetDir(target.bp, "bp");
    }
    if (config.packs.rp && target.rp) {
        await validateTargetDir(target.rp, "rp");
    }

    if (target.bp) {
        const folderName = names.bp ?? config.packs.bp.name;
        const to = path.join(target.bp, folderName);
        const bpIncludes = getIncludes(DEFAULT_BP_INCLUDES, config.copy.include?.bp);
        if (!dryRun) {
            await copySelectedItems(bpRoot(cwd, config), to, bpIncludes);
        }
        logger?.copy(
            `${dryRun ? "would copy" : "copied"} bp (${bpIncludes.length} items) -> ${colors.gray(to)}`
        );
        copied.push(to);
    }
    if (config.packs.rp && target.rp) {
        const folderName = names.rp ?? config.packs.rp.name;
        const to = path.join(target.rp, folderName);
        const rpIncludes = getIncludes(DEFAULT_RP_INCLUDES, config.copy.include?.rp);
        if (!dryRun) {
            if (rpIncludes.length > 0) {
                await copySelectedItems(rpRoot(cwd, config), to, rpIncludes);
            } else {
                // No includes configured — full copy for backward compatibility
                await copyDir(rpRoot(cwd, config), to);
            }
        }
        logger?.copy(
            `${dryRun ? "would copy" : "copied"} rp${rpIncludes.length ? ` (${rpIncludes.length} items)` : ""} -> ${colors.gray(to)}`
        );
        copied.push(to);
    }
    return { target: targetNameResolved, copied };
}
