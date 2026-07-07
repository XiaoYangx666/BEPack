import chokidar from "chokidar";
import path from "node:path";
import type { ResolvedConfig } from "../config/configTypes.js";
import type { Logger } from "../logger/logger.js";
import { runBuild } from "../build/runBuild.js";
import { copyPacks } from "../copy/copyPacks.js";
import {
    bpManifest,
    bpRoot,
    distRoot,
    rpManifest,
    rpRoot,
    slash,
    srcEntry,
} from "../utils/path.js";

export function watchProject(
    cwd: string,
    config: ResolvedConfig,
    logger: Logger,
    copyTarget?: string
) {
    const relative = (value: string) => slash(path.relative(cwd, value));
    const srcWatchRoot = relative(path.dirname(srcEntry(cwd, config)));
    const bpWatchRoot = relative(bpRoot(cwd, config));
    const rpWatchRoot = relative(rpRoot(cwd, config));
    const watchRoots = [srcWatchRoot, bpWatchRoot, ...(config.packs.rp ? [rpWatchRoot] : [])];
    const ignored = [
        "node_modules",
        relative(distRoot(cwd, config)),
        ".git",
        relative(path.join(bpRoot(cwd, config), "scripts")),
        relative(bpManifest(cwd, config)),
        relative(rpManifest(cwd, config)),
    ];
    const watcher = chokidar.watch(watchRoots, {
        cwd,
        ignored,
        ignoreInitial: true,
    });
    watcher.on("all", async (_event, file) => {
        const start = Date.now();
        try {
            logger.clear();
            const normalized = slash(file);
            logger.bepack("dev", `changed ${path.normalize(file)}`);
            if (normalized === srcWatchRoot || normalized.startsWith(`${srcWatchRoot}/`)) {
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
        }
    });
    logger.progress("dev", `watching ${watchRoots.join(", ")}`);
    return watcher;
}
