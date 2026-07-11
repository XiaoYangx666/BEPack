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

export type DevWatchOptions = {
    copy: boolean;
    copyTarget?: string;
    typecheck: boolean;
    cache: boolean;
    dryRun: boolean;
    quiet?: boolean;
};

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
    const rpIncludes = config.packs.rp?.include;
    if (rpIncludes && rpIncludes.length > 0) {
        return resolveWatchPaths(
            packRoot(root, config, "rp")!,
            DEFAULT_RP_INCLUDES,
            rpIncludes,
            cwd
        );
    }
    return [slash(path.relative(cwd, packRoot(root, config, "rp")!))];
}

export function watchProject(
    cwd: string,
    config: ResolvedConfig,
    logger: Logger,
    options: DevWatchOptions
) {
    const relative = (value: string) => slash(path.relative(cwd, value));
    const root = projectRoot(cwd, config);
    const compile = hasBpCompile(config);
    const watchRoots: string[] = [];

    if (compile) {
        const entry = srcEntry(cwd, config);
        if (entry) watchRoots.push(relative(path.dirname(entry)));
    }

    for (const pack of getConfiguredPacks(config)) {
        watchRoots.push(...getPackWatchPaths(config, pack.type, cwd, root));
    }

    if (config.dev.watch?.include) watchRoots.push(...config.dev.watch.include);

    const watcher = chokidar.watch(watchRoots, {
        cwd,
        ignored: ["node_modules", relative(distRoot(cwd, config)), ".git"],
        ignoreInitial: true,
    });

    let building = false;
    let pendingRebuild = false;
    let pendingCopy = false;

    const copyIfEnabled = async () => {
        if (options.copy) {
            await copyPacks(cwd, config, options.copyTarget, options.dryRun, logger);
        }
    };

    const rebuild = async () => {
        if (compile) {
            await runBuild({
                cwd,
                config,
                logger,
                typecheck: options.typecheck,
                cache: options.cache,
                dryRun: options.dryRun,
                quiet: Boolean(options.quiet),
            });
        } else {
            const { patchManifest } = await import("../manifest/patchManifest.js");
            await patchManifest({ cwd, config, dryRun: options.dryRun, logger });
        }
        await copyIfEnabled();
    };

    watcher.on("all", async (_event, file) => {
        const normalized = slash(file);
        const entry = compile ? srcEntry(cwd, config) : undefined;
        const srcEntryDir = entry ? relative(path.dirname(entry)) : undefined;
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
                await rebuild();
            } else {
                const { patchManifest } = await import("../manifest/patchManifest.js");
                await patchManifest({ cwd, config, dryRun: options.dryRun, logger });
                await copyIfEnabled();
            }
            logger.done(
                "dev",
                `updated after ${path.normalize(file)} in ${logger.formatDuration(Date.now() - start)}`
            );
        } catch (error) {
            logger.error(error instanceof Error ? error.message : String(error));
        } finally {
            building = false;
            if (pendingRebuild) {
                pendingRebuild = false;
                pendingCopy = false;
                building = true;
                const retryStart = Date.now();
                try {
                    logger.clear();
                    logger.bepack("dev", "rebuilding (pending changes)");
                    await rebuild();
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
                try {
                    await copyIfEnabled();
                } catch (error) {
                    logger.error(error instanceof Error ? error.message : String(error));
                }
            }
        }
    });

    logger.progress("dev", `watching ${watchRoots.join(", ")}`);
    return watcher;
}
