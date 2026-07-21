import path from "node:path";
import { promises as fs } from "node:fs";
import type { PackType, ResolvedConfig } from "../config/configTypes.js";
import { getConfiguredPacks } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { copyDir, pathExists } from "../utils/fs.js";
import { containsPath, packRoot, projectRoot, getBpIncludeItems } from "../utils/path.js";
import { DEFAULT_RP_INCLUDES } from "../constants/copyIncludes.js";
import { resolveCopyTarget } from "./resolveCopyTarget.js";
import type { Logger } from "../logger/logger.js";
import pc from "picocolors";

const colors = pc.createColors(
    process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== "0"
);

/**
 * Copy specific items from source to target directory.
 * Target is removed first, then recreated, then each item is copied.
 * Missing source items are silently skipped.
 */
async function copySelectedItems(source: string, target: string, items: string[]): Promise<void> {
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

/** Refuse copy operations that would delete or recursively copy the source pack. */
export function assertSafeCopyDestination(source: string, target: string): void {
    const resolvedSource = path.resolve(source);
    const resolvedTarget = path.resolve(target);
    if (
        containsPath(resolvedSource, resolvedTarget) ||
        containsPath(resolvedTarget, resolvedSource)
    ) {
        throw new BePackError(
            "COPY_FAILED",
            `Copy target "${target}" overlaps source pack "${source}". Refusing to copy.`,
            { details: { source: resolvedSource, target: resolvedTarget } }
        );
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

/** Resolve include items for a given pack type. */
function getPackIncludeItems(config: ResolvedConfig, packType: PackType): string[] {
    if (packType === "bp") {
        return getBpIncludeItems(config);
    }
    // RP: check packs.rp.include first, then legacy copy.include.rp
    const userItems = config.packs.rp?.include ?? [];
    const legacyItems = config.copy.include?.rp ?? [];
    const effectiveUser = userItems.length > 0 ? userItems : legacyItems;
    return effectiveUser.length > 0 ? [...DEFAULT_RP_INCLUDES, ...effectiveUser] : [];
}

async function copyOnePack(
    packType: PackType,
    source: string,
    targetDir: string,
    folderName: string,
    config: ResolvedConfig,
    dryRun: boolean,
    logger?: Logger
): Promise<string> {
    const includes = getPackIncludeItems(config, packType);
    const to = path.join(targetDir, folderName);
    assertSafeCopyDestination(source, to);

    if (!dryRun) {
        if (packType === "bp" || includes.length > 0) {
            // BP is always selective; RP is selective only when includes are configured
            await copySelectedItems(source, to, includes);
        } else {
            // RP with no configured includes: full directory copy
            await copyDir(source, to);
        }
    }

    const itemCount = includes.length > 0 ? includes.length : undefined;
    logger?.copy(
        `${dryRun ? "would copy" : "copied"} ${packType}${itemCount ? ` (${itemCount} items)` : ""} -> ${colors.gray(to)}`
    );
    return to;
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

    const root = projectRoot(cwd, config);
    const packs = getConfiguredPacks(config);

    for (const p of packs) {
        // Determine target path for this pack type
        let packTargetDir: string | undefined;
        if (p.type === "bp") packTargetDir = target.bp;
        else packTargetDir = target.rp;

        if (!packTargetDir) continue;

        await validateTargetDir(packTargetDir, p.type);

        const folderName = names[p.type] ?? p.name;
        const source = packRoot(root, config, p.type)!;
        const dest = await copyOnePack(
            p.type,
            source,
            packTargetDir,
            folderName,
            config,
            dryRun,
            logger
        );
        copied.push(dest);
    }

    return { target: targetNameResolved, copied };
}
