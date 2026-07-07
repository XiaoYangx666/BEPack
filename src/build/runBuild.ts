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

export async function runBuild(options: RunBuildOptions) {
    const start = Date.now();
    const root = projectRoot(options.cwd, options.config);
    await patchManifest({
        cwd: options.cwd,
        config: options.config,
        dryRun: Boolean(options.dryRun),
        ...(options.resolvedDeps ? { resolvedDeps: options.resolvedDeps } : {}),
    });
    await runHook("beforeBuild", "build", options.cwd, options.config, options.logger);
    options.logger.manifest("manifest.json updated");
    if (!options.dryRun && options.typecheck !== false)
        await runTypecheck(root, {
            quiet: Boolean(options.quiet),
            useNpx: options.config.build.useNpx,
        });
    if (options.typecheck !== false) options.logger.typescript("typecheck complete");
    if (!options.dryRun) await runRolldown(options.cwd, options.config);
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
