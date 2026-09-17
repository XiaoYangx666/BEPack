import path from "node:path";
import { promises as fs } from "node:fs";
import type { PackType, ResolvedConfig } from "../config/configTypes.js";
import { getConfiguredPacks } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { copyDir, pathExists } from "../utils/fs.js";
import { containsPath, packRoot, projectRoot, getBpIncludeItems } from "../utils/path.js";
import { DEFAULT_RP_INCLUDES } from "../constants/copyIncludes.js";
import { PACK_OPTIMIZE_DEFAULTS } from "../config/defaultConfig.js";
import {
    collectDirFiles,
    collectSelectedFiles,
    transformFiles,
    writeFileMap,
} from "../pack/fileMap.js";
import { createPackOptimizer } from "../pack/optimizePack.js";
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

/** Resolve a pack folder name without allowing it to escape the target root. */
export function resolveSafeCopyDestination(targetDir: string, folderName: string): string {
    const resolvedTargetDir = path.resolve(targetDir);
    const destination = path.resolve(resolvedTargetDir, folderName);
    if (destination === resolvedTargetDir || !containsPath(resolvedTargetDir, destination)) {
        throw new BePackError(
            "COPY_FAILED",
            `Copy folder name "${folderName}" must resolve to a directory inside "${targetDir}".`,
            { details: { targetDir: resolvedTargetDir, folderName, destination } }
        );
    }
    return destination;
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

/** Read a pack's manifest for the optimization engine-version check. */
async function readManifestBytes(source: string): Promise<Uint8Array | undefined> {
    try {
        return new Uint8Array(await fs.readFile(path.join(source, "manifest.json")));
    } catch {
        return undefined;
    }
}

async function copyOnePack(
    packType: PackType,
    source: string,
    targetDir: string,
    folderName: string,
    config: ResolvedConfig,
    dryRun: boolean,
    logger?: Logger,
    optimize?: boolean
): Promise<string> {
    const includes = getPackIncludeItems(config, packType);
    const to = resolveSafeCopyDestination(targetDir, folderName);
    assertSafeCopyDestination(source, to);

    // `copy.optimize` mirrors the packaged artifact in the dev folder, so an optimized
    // pack can be tested in-game before it ships.
    const optimizeOptions =
        optimize === undefined
            ? config.copy.optimize
            : optimize
              ? (config.copy.optimize ?? PACK_OPTIMIZE_DEFAULTS)
              : undefined;

    if (!dryRun) {
        if (optimizeOptions) {
            const selective = packType === "bp" || includes.length > 0;
            const collected = selective
                ? await collectSelectedFiles(source, includes)
                : await collectDirFiles(source);
            const transform = createPackOptimizer(
                optimizeOptions,
                logger,
                await readManifestBytes(source)
            );
            try {
                await writeFileMap(to, await transformFiles(collected, transform));
            } catch (error) {
                // Report optimization failures under the copy command's own error code.
                if (error instanceof BePackError) {
                    throw new BePackError(
                        error.code === "PACK_FAILED" ? "COPY_FAILED" : error.code,
                        error.message,
                        {
                            ...(error.details !== undefined ? { details: error.details } : {}),
                            ...(error.suggestions !== undefined
                                ? { suggestions: error.suggestions }
                                : {}),
                        }
                    );
                }
                throw error;
            }
        } else if (packType === "bp" || includes.length > 0) {
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

export type CopyPacksOptions = {
    /**
     * CLI `--optimize` override for the copied dev folder. `true` forces optimization
     * (using `copy.optimize` options when configured), `false` forces it off,
     * `undefined` follows the config.
     */
    optimize?: boolean;
};

export async function copyPacks(
    cwd: string,
    config: ResolvedConfig,
    targetName?: string,
    dryRun = false,
    logger?: Logger,
    options: CopyPacksOptions = {}
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
            logger,
            options.optimize
        );
        copied.push(dest);
    }

    return { target: targetNameResolved, copied };
}
