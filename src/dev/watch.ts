import chokidar from "chokidar";
import path from "node:path";
import { runBuild } from "../build/runBuild.js";
import type { PackType, ResolvedConfig } from "../config/configTypes.js";
import { getConfiguredPacks } from "../config/configTypes.js";
import {
    DEFAULT_BP_INCLUDES,
    DEFAULT_RP_INCLUDES,
    getIncludes,
} from "../constants/copyIncludes.js";
import { copyPacks } from "../copy/copyPacks.js";
import type { Logger } from "../logger/logger.js";
import { distRoot, hasBpCompile, packRoot, projectRoot, slash, srcEntry } from "../utils/path.js";

/**
 * Resolve the list of paths to watch for a pack directory.
 */
function resolveWatchPaths(
    packRootDir: string,
    defaults: string[],
    userAdditions: string[] | undefined,
    cwd: string,
    filterOut: string[] = ["scripts", "manifest.json"]
): string[] {
    const items = getIncludes(defaults, userAdditions)
        .filter((item) => !filterOut.includes(item))
        .map((item) => path.join(packRootDir, item));
    return [...new Set(items)].map((p) => slash(path.relative(cwd, p)));
}

/** Resolve watch paths for a specific pack type. */
function getPackWatchPaths(
    config: ResolvedConfig,
    packType: PackType,
    cwd: string,
    root: string
): string[] {
    if (packType === "bp") {
        return resolveWatchPaths(
            packRoot(root, config, "bp")!,
            DEFAULT_BP_INCLUDES,
            config.packs.bp?.include,
            cwd
        );
    }
    // RP
    const rpIncludes = config.packs.rp?.include;
    if (rpIncludes && rpIncludes.length > 0) {
        return resolveWatchPaths(
            packRoot(root, config, "rp")!,
            DEFAULT_RP_INCLUDES,
            rpIncludes,
            cwd
        );
    }
    // No RP includes — watch the whole RP directory (backward compat)
    return [slash(path.relative(cwd, packRoot(root, config, "rp")!))];
}

export function watchProject(
    cwd: string,
    config: ResolvedConfig,
    logger: Logger,
    copyTarget?: string
) {
    const relative = (value: string) => slash(path.relative(cwd, value));
    const root = projectRoot(cwd, config);
    const compile = hasBpCompile(config);
    const watchRoots: string[] = [];

    // Source directory (only when BP has compile)
    if (compile) {
        const entry = srcEntry(cwd, config);
        if (entry) {
            watchRoots.push(relative(path.dirname(entry)));
        }
    }

    // Pack file watchers (for copy-on-change)
    for (const p of getConfiguredPacks(config)) {
        const paths = getPackWatchPaths(config, p.type, cwd, root);
        watchRoots.push(...paths);
    }

    // User additions from dev.watch.include
    if (config.dev.watch?.include) {
        watchRoots.push(...config.dev.watch.include);
    }

    const ignored = ["node_modules", relative(distRoot(cwd, config)), ".git"];

    const watcher = chokidar.watch(watchRoots, {
        cwd,
        ignored,
        ignoreInitial: true,
    });

    // Serialize builds: skip rapid changes while a build is in progress,
    // then schedule one final rebuild if changes were queued.
    let building = false;
    let pendingRebuild = false; // src change arrived during build → needs rebuild + copy
    let pendingCopy = false; // non-src change arrived during build → needs copy only

    watcher.on("all", async (_event, file) => {
        const normalized = slash(file);
        const srcEntryDir =
            compile && srcEntry(cwd, config)
                ? relative(path.dirname(srcEntry(cwd, config)!))
                : undefined;
        const isSrc = srcEntryDir ? normalized.startsWith(`${srcEntryDir}/`) : false;

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
            if (isSrc && compile) {
                // Source change: full rebuild (manifest + compile)
                await runBuild({
                    cwd,
                    config,
                    logger,
                    typecheck: config.packs.bp!.compile!.typecheck,
                    cache: config.packs.bp!.compile!.cache.dev,
                });
            } else {
                // Non-source change: just update manifest and copy
                const { patchManifest } = await import("../manifest/patchManifest.js");
                await patchManifest({ cwd, config, logger });
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
                    if (compile) {
                        await runBuild({
                            cwd,
                            config,
                            logger,
                            typecheck: config.packs.bp!.compile!.typecheck,
                            cache: config.packs.bp!.compile!.cache.dev,
                        });
                    } else {
                        const { patchManifest } = await import("../manifest/patchManifest.js");
                        await patchManifest({ cwd, config, logger });
                    }
                    if (copyTarget || config.dev.copy) {
                        const target =
                            copyTarget ??
                            (typeof config.dev.copy === "string" ? config.dev.copy : undefined);
                        await copyPacks(cwd, config, target, false, logger);
                    }
                    logger.done(
                        "dev",
                        `rebuild done in ${logger.formatDuration(Date.now() - retryStart)}`
                    );
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
