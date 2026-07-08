import type { ResolvedConfig } from "../config/configTypes.js";
import { patchManifest } from "../manifest/patchManifest.js";
import { runTypecheck } from "./runTypecheck.js";
import { runRolldown } from "./runRolldown.js";
import { runHook } from "../hooks/runHook.js";
import type { Logger } from "../logger/logger.js";
import { projectRoot, slash } from "../utils/path.js";

export type RunBuildOptions = {
    cwd: string;
    config: ResolvedConfig;
    logger: Logger;
    typecheck?: boolean;
    dryRun?: boolean;
    quiet?: boolean;
    resolvedDeps?: Record<string, string>;
};

async function timed<T>(
    label: string,
    fn: () => Promise<T>,
    logger: Logger,
    timing: boolean
): Promise<T> {
    const start = timing ? Date.now() : 0;
    const result = await fn();
    if (timing) logger.timing(label, Date.now() - start);
    return result;
}

export async function runBuild(options: RunBuildOptions) {
    const start = Date.now();
    const timing = options.config.build.timing;
    const root = projectRoot(options.cwd, options.config);
    await timed("manifest", () =>
        patchManifest({
            cwd: options.cwd,
            config: options.config,
            dryRun: Boolean(options.dryRun),
            ...(options.resolvedDeps ? { resolvedDeps: options.resolvedDeps } : {}),
        }),
        options.logger,
        timing
    );
    options.logger.manifest("manifest.json updated");
    await runHook("beforeBuild", "build", options.cwd, options.config, options.logger);
    if (!options.dryRun && options.typecheck !== false)
        await timed(
            "typecheck",
            () => runTypecheck(root, { quiet: Boolean(options.quiet), useNpx: options.config.build.useNpx }),
            options.logger,
            timing
        );
    if (options.typecheck !== false) options.logger.typescript("typecheck complete");
    if (!options.dryRun)
        await timed(
            "rolldown",
            () => runRolldown(options.cwd, options.config, options.logger),
            options.logger,
            timing
        );
    options.logger.rolldown(
        options.config.build.preserveModules ? "preserve modules build complete" : "bundle complete"
    );
    await runHook("afterBuild", "build", options.cwd, options.config, options.logger);
    const durationMs = Date.now() - start;
    return {
        script: slash(`${options.config.packs.bp.root}/scripts/main.js`),
        typecheck: options.typecheck !== false,
        durationMs,
    };
}
