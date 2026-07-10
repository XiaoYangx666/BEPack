import chokidar from "chokidar";
import path from "node:path";
import type { ResolvedConfig } from "../config/configTypes.js";
import type { Logger } from "../logger/logger.js";
import { runBuild } from "../build/runBuild.js";
import { copyPacks } from "../copy/copyPacks.js";
import {
    bpRoot,
    distRoot,
    rpRoot,
    slash,
    srcEntry,
} from "../utils/path.js";
import { DEFAULT_BP_INCLUDES, DEFAULT_RP_INCLUDES, getIncludes } from "../constants/copyIncludes.js";

/**
 * Resolve the list of paths to watch for a pack directory.
 *
 * For BP: the copy include items (minus build artifacts), so editing anything
 * that won't be copied doesn't trigger a pointless rebuild.
 *
 * For RP: items from copy include if configured, or the whole directory.
 */
function resolveWatchPaths(
    packRoot: string,
    defaults: string[],
    userAdditions: string[] | undefined,
    cwd: string,
    filterOut: string[] = ["scripts", "manifest.json"]
): string[] {
    const items = getIncludes(defaults, userAdditions)
        .filter((item) => !filterOut.includes(item))
        .map((item) => path.join(packRoot, item));
    // Deduplicate and resolve relative paths
    return [...new Set(items)].map((p) => slash(path.relative(cwd, p)));
}

export function watchProject(
    cwd: string,
    config: ResolvedConfig,
    logger: Logger,
    copyTarget?: string
) {
    const relative = (value: string) => slash(path.relative(cwd, value));

    // Always watch the TypeScript source directory
    const srcWatchRoot = relative(path.dirname(srcEntry(cwd, config)));

    // BP: only watch items from the copy include list (minus build artifacts)
    const bpWatchPaths = resolveWatchPaths(
        bpRoot(cwd, config),
        DEFAULT_BP_INCLUDES,
        config.packs.bp.include,
        cwd
    );

    // RP: items from include if selective, otherwise the full directory
    const rpWatchPaths: string[] = [];
    if (config.packs.rp) {
        const rpIncludes = getIncludes(DEFAULT_RP_INCLUDES, config.copy.include?.rp);
        if (rpIncludes.length > 0) {
            rpWatchPaths.push(
                ...resolveWatchPaths(
                    rpRoot(cwd, config),
                    DEFAULT_RP_INCLUDES,
                    config.copy.include?.rp,
                    cwd
                )
            );
        } else {
            // No RP includes — watch the whole RP directory
            rpWatchPaths.push(relative(rpRoot(cwd, config)));
        }
    }

    // User additions from dev.watch.include
    const userWatchPaths = config.dev.watch?.include ?? [];

    const watchRoots = [
        srcWatchRoot,
        ...bpWatchPaths,
        ...rpWatchPaths,
        ...userWatchPaths,
    ];

    const ignored = [
        "node_modules",
        relative(distRoot(cwd, config)),
        ".git",
    ];

    const watcher = chokidar.watch(watchRoots, {
        cwd,
        ignored,
        ignoreInitial: true,
    });

    // Serialize builds: skip rapid changes while a build is in progress,
    // then schedule one final rebuild if changes were queued.
    let building = false;
    let pendingRebuild = false;   // src change arrived during build → needs rebuild + copy
    let pendingCopy = false;      // non-src change arrived during build → needs copy only

    watcher.on("all", async (_event, file) => {
        const normalized = slash(file);
        const isSrc = normalized.startsWith(`${srcWatchRoot}/`);

        if (building) {
            if (isSrc) pendingRebuild = true;
            else pendingCopy = true;
            return;
        }

        building = true;
        const start = Date.now();
        try {
            logger.clear();
            logger.bepack("dev", `changed ${path.normalize(file)}`);
            if (isSrc) {
                await runBuild({ cwd, config, logger, typecheck: config.build.typecheck });
            }
            if (copyTarget || config.dev.copy) {
                const target =
                    copyTarget ??
                    (typeof config.dev.copy === "string" ? config.dev.copy : undefined);
                await copyPacks(cwd, config, target, false, logger);
            }
            logger.done(
                "dev",
                `updated after ${path.normalize(file)} in ${logger.formatDuration(Date.now() - start)}`
            );
        } catch (error) {
            logger.error(error instanceof Error ? error.message : String(error));
        } finally {
            building = false;
            // Drain pending changes that arrived during the build
            if (pendingRebuild) {
                pendingRebuild = false;
                pendingCopy = false;
                building = true;
                const retryStart = Date.now();
                try {
                    logger.clear();
                    logger.bepack("dev", "rebuilding (pending changes)");
                    await runBuild({ cwd, config, logger, typecheck: config.build.typecheck });
                    if (copyTarget || config.dev.copy) {
                        const target =
                            copyTarget ??
                            (typeof config.dev.copy === "string" ? config.dev.copy : undefined);
                        await copyPacks(cwd, config, target, false, logger);
                    }
                    logger.done("dev", `rebuild done in ${logger.formatDuration(Date.now() - retryStart)}`);
                } catch (error) {
                    logger.error(error instanceof Error ? error.message : String(error));
                } finally {
                    building = false;
                }
            } else if (pendingCopy) {
                pendingCopy = false;
                const retryStart = Date.now();
                try {
                    if (copyTarget || config.dev.copy) {
                        const target =
                            copyTarget ??
                            (typeof config.dev.copy === "string" ? config.dev.copy : undefined);
                        await copyPacks(cwd, config, target, false, logger);
                    }
                } catch (error) {
                    logger.error(error instanceof Error ? error.message : String(error));
                }
            }
        }
    });

    logger.progress("dev", `watching ${watchRoots.join(", ")}`);
    return watcher;
}
