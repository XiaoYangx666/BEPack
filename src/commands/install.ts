import { loadConfig } from "../config/loadConfig.js";
import { DependencyService } from "../install/DependencyService.js";
import { patchPackageJson } from "../install/patchPackageJson.js";
import { patchManifest } from "../manifest/patchManifest.js";
import { PackageManager } from "../utils/packageManager.js";
import { runHook } from "../hooks/runHook.js";
import { Logger } from "../logger/logger.js";

export async function commandInstall(options: any) {
    const logger = new Logger({ ...options, silent: options.silent || options.json });
    const overrides: any = { target: options.target };
    if (
        options.registry ||
        options.pm ||
        options.saveTo ||
        options.skipPm ||
        options.skipManifest ||
        options.skipPackageJson
    ) {
        overrides.install = {
            ...(options.registry ? { registry: options.registry } : {}),
            ...(options.pm ? { packageManager: options.pm } : {}),
            ...(options.saveTo ? { saveTo: options.saveTo } : {}),
            ...(options.skipPm ? { runPackageManager: false } : {}),
            ...(options.skipManifest ? { updateManifest: false } : {}),
            ...(options.skipPackageJson ? { updatePackageJson: false } : {}),
        };
    }
    const { cwd, config } = await loadConfig({
        cwd: options.cwd ?? process.cwd(),
        configPath: options.config,
        overrides,
    });
    await runHook("beforeInstall", "install", cwd, config, logger);
    const resolved = await new DependencyService(config, logger).resolveAll();
    const resolvedManifestVersions = Object.fromEntries(
        Object.entries(resolved)
            .filter(([, dep]) => dep.manifestVersion !== null)
            .map(([name, dep]) => [name, dep.manifestVersion as string])
    );
    const files: any = {};
    if (config.install.updatePackageJson)
        files.packageJson = await patchPackageJson(cwd, config, resolved, options.dryRun);
    if (config.install.updateManifest)
        Object.assign(
            files,
            await patchManifest({
                cwd,
                config,
                dryRun: options.dryRun,
                logger,
                resolvedDeps: resolvedManifestVersions,
            })
        );
    const pm = new PackageManager(cwd, config.install.registry);
    const manager = await pm.detect(config.install.packageManager);
    let packageInstall = { ran: false, manager, exitCode: null as number | null };
    if (!options.dryRun && config.install.runPackageManager) {
        logger.progress(
            "Install",
            `running ${manager} install with registry ${config.install.registry}`
        );
        packageInstall = { ran: true, manager, exitCode: await pm.install(manager) };
    }
    await runHook("afterInstall", "install", cwd, config, logger);
    logger.success("Install", "done");
    return {
        ok: true,
        command: "install",
        target: config.target,
        packageManager: manager,
        resolved,
        files,
        packageInstall,
    };
}
