import chokidar from "chokidar";
import path from "node:path";
import { runBuild } from "../build/runBuild.js";
import type { PackType, ResolvedConfig } from "../config/configTypes.js";
import { getConfiguredPacks } from "../config/configTypes.js";
import { copyPacks } from "../copy/copyPacks.js";
import type { Logger } from "../logger/logger.js";
import {
    distRoot,
    hasBpCompile,
    packRoot,
    projectRoot,
    slash,
    srcEntry,
    getBpIncludeItems,
    deduplicatePaths,
} from "../utils/path.js";

export type DevWatchOptions = {
    copy: boolean;
    copyTarget?: string;
    typecheck: boolean;
    cache: boolean;
    dryRun: boolean;
    quiet?: boolean;
    mode?: string;
};

function relativeTo(cwd: string, p: string): string {
    return slash(path.relative(cwd, p));
}

export function watchProject(
    cwd: string,
    config: ResolvedConfig,
    logger: Logger,
    options: DevWatchOptions
) {
    const root = projectRoot(cwd, config);
    const compile = hasBpCompile(config);
    const watchRoots: string[] = [];

    // Always watch TypeScript source directory when compile is configured
    if (compile) {
        const entry = srcEntry(cwd, config);
        if (entry) {
            watchRoots.push(relativeTo(cwd, path.dirname(entry)));
        }
    }

    // Only watch BP/RP content directories when copy is enabled
    if (options.copy) {
        for (const pack of getConfiguredPacks(config)) {
            const pRoot = packRoot(root, config, pack.type);
            if (pRoot) {
                const packIncludes = getPackWatchIncludes(cwd, config, pack.type, root);
                watchRoots.push(...packIncludes);
            }
        }
    }

    // User-configured additional watch paths
    const extraWatchPaths = config.dev.watch?.include ?? [];
    watchRoots.push(...extraWatchPaths);

    // Deduplicate watch roots using the shared platform-aware helper
    const dedupedRoots = deduplicatePaths(watchRoots.map((p) => path.resolve(cwd, p))).map((p) =>
        relativeTo(cwd, p)
    );

    // Build ignored paths list
    const ignored: string[] = ["node_modules", ".git", relativeTo(cwd, distRoot(cwd, config))];

    for (const pack of getConfiguredPacks(config)) {
        const pRoot = packRoot(root, config, pack.type);
        if (!pRoot) continue;

        // BePack 自己会修改 manifest，不能让它再次触发 dev
        ignored.push(relativeTo(cwd, path.join(pRoot, "manifest.json")));

        // Rolldown 会向脚本输出目录写入编译结果，必须忽略
        if (pack.type === "bp" && compile) {
            const bpDir = packRoot(root, config, "bp")!;
            const scriptDir = config.packs.bp!.compile!.scriptOutputDir;
            ignored.push(relativeTo(cwd, path.join(bpDir, scriptDir)));
        }
    }

    const watcher = chokidar.watch(dedupedRoots, {
        cwd,
        ignored,
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
                ...(options.mode === undefined ? {} : { mode: options.mode }),
            });
        } else {
            const { patchManifest } = await import("../manifest/patchManifest.js");
            await patchManifest({ cwd, config, dryRun: options.dryRun, logger });
        }
        await copyIfEnabled();
    };

    /**
     * Drain pending work in a loop so that changes arriving during a
     * rebuild don't get lost. When another source change arrives during
     * a rebuild, we re-enter the loop after it finishes.
     */
    const drainPending = async (): Promise<void> => {
        while (pendingRebuild || pendingCopy) {
            const hasRebuild = pendingRebuild;
            pendingRebuild = false;
            pendingCopy = false;
            const start = Date.now();
            try {
                logger.clear();
                if (hasRebuild) {
                    logger.bepack("dev", "rebuilding (pending changes)");
                    await rebuild();
                    logger.done(
                        "dev",
                        `rebuild done in ${logger.formatDuration(Date.now() - start)}`
                    );
                } else {
                    await copyIfEnabled();
                }
            } catch (error) {
                logger.error(error instanceof Error ? error.message : String(error));
            }
        }
    };

    watcher.on("all", async (_event, file) => {
        const normalized = slash(file);
        const entry = compile ? srcEntry(cwd, config) : undefined;
        const srcDir = entry ? path.dirname(entry) : undefined;
        // Use absolute path comparison to handle root-level entries correctly
        // (when entry is "main.ts", srcDir may be the project root itself,
        //  and relativeTo(cwd, srcDir) would be "" which is falsy)
        const changedAbs = path.resolve(cwd, normalized);
        const isSrc = srcDir
            ? changedAbs === srcDir || changedAbs.startsWith(srcDir + path.sep)
            : false;

        if (building) {
            if (isSrc) pendingRebuild = true;
            else if (options.copy) pendingCopy = true;
            return;
        }

        building = true;
        const start = Date.now();
        try {
            logger.clear();
            logger.bepack("dev", `changed ${path.normalize(file)}`);
            if (isSrc && compile) {
                await rebuild();
            } else if (options.copy) {
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
            // Keep building=true while draining; release only after drain completes
            try {
                await drainPending();
            } finally {
                building = false;
            }
        }
    });

    // Generate watch summary
    const bpRootDir = config.packs.bp
        ? slash(path.relative(cwd, packRoot(root, config, "bp")!))
        : null;
    const rpRootDir = config.packs.rp
        ? slash(path.relative(cwd, packRoot(root, config, "rp")!))
        : null;
    const srcEntryDir =
        compile && srcEntry(cwd, config)
            ? relativeTo(cwd, path.dirname(srcEntry(cwd, config)!))
            : null;
    let srcInBpRp = false;
    const groups: string[] = [];
    let bpCount = 0;
    let rpCount = 0;
    for (const w of dedupedRoots) {
        if (bpRootDir && (w === bpRootDir || w.startsWith(bpRootDir + "/"))) {
            bpCount++;
            if (srcEntryDir && (w === srcEntryDir || w.startsWith(srcEntryDir + "/")))
                srcInBpRp = true;
        } else if (rpRootDir && (w === rpRootDir || w.startsWith(rpRootDir + "/"))) {
            rpCount++;
            if (srcEntryDir && (w === srcEntryDir || w.startsWith(srcEntryDir + "/")))
                srcInBpRp = true;
        } else if (srcEntryDir && (w === srcEntryDir || w.startsWith(srcEntryDir + "/"))) {
            // standalone source entry — will be added below
        } else {
            groups.push(w);
        }
    }
    if (srcEntryDir && !srcInBpRp) groups.unshift(srcEntryDir);
    if (bpCount > 0) groups.push(`bp(${bpCount})`);
    if (rpCount > 0) groups.push(`rp(${rpCount})`);
    logger.progress("dev", `watching ${groups.join(", ")}`);
    return watcher;
}

function getPackWatchIncludes(
    cwd: string,
    config: ResolvedConfig,
    packType: PackType,
    projectRootDir: string
): string[] {
    const pRoot = packRoot(projectRootDir, config, packType);
    if (!pRoot) return [];

    if (packType === "bp") {
        const items = getBpIncludeItems(config);
        return items
            .filter((item) => item !== "manifest.json")
            .map((item) => slash(path.relative(cwd, path.join(pRoot, item))));
    }

    const rp = config.packs.rp;
    if (!rp) return [];

    if (rp.include && rp.include.length > 0) {
        return rp.include
            .filter((item) => item !== "manifest.json")
            .map((item) => slash(path.relative(cwd, path.join(pRoot, item))));
    }
    return [slash(path.relative(cwd, pRoot))];
}
