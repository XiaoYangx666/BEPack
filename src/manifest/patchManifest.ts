import path from "node:path";
import pc from "picocolors";
import { bpManifest, rpManifest, slash } from "../utils/path.js";
import { createDependencyCatalog } from "../install/dependencyCatalog.js";
import type { ResolvedConfig, LoggerLike } from "../config/configTypes.js";
import { ManifestFile } from "./ManifestFile.js";
import { ManifestBuilder } from "./ManifestBuilder.js";
import { ManifestDepManager } from "./ManifestDepManager.js";
import type { DependencyVersionSource } from "./ManifestDepManager.js";
import type { Manifest } from "./types.js";

export type PatchManifestOptions = {
    cwd: string;
    config: ResolvedConfig;
    dryRun?: boolean;
    /** Concrete versions resolved by `bepack install` / `build --install` (channel specifiers only). */
    resolvedDeps?: Record<string, string>;
    logger?: LoggerLike;
};

/** One managed dependency as written to `manifest.json`. */
export type PatchedManifestDependency = {
    module_name: string;
    /** Specifier from `packs.bp.dependencies` (e.g. `"stable"` or `"2.10.0"`). */
    specifier: string;
    /** Version actually written. */
    version: string;
    /** Where the version came from: the config, a fresh install, or the existing manifest. */
    source: DependencyVersionSource;
    /** Version the manifest held before this patch, when it had one. */
    previous?: string;
};

export type PatchedManifestFile = {
    path: string;
    updated: boolean;
    existed: boolean;
    /** Only present for the BP manifest: the managed dependencies that were written. */
    dependencies?: PatchedManifestDependency[];
};

export type PatchManifestResult = {
    bpManifest?: PatchedManifestFile;
    rpManifest?: PatchedManifestFile;
};

const colors = pc.createColors(
    process.env.NO_COLOR === undefined && process.env.FORCE_COLOR !== "0"
);

/**
 * 修补 BP 和/或 RP manifest 文件。
 *
 * - 只负责任务编排：路径计算、文件读写、调用构建器和依赖管理器。
 * - 如果 manifest 已存在，保留用户手写字段并覆盖 BePack 管理字段。
 * - 如果 manifest 不存在，根据配置完整生成。
 * - dryRun 时返回结果但不写入文件。
 * - 只修补已配置的 Pack（至少一个必须存在）。
 *
 * 受管依赖的版本优先级：config 中的具体版本 > `resolvedDeps`（install 解析）>
 * 现有 manifest 中的版本。版本发生变化或复用了旧值时都会打印说明，避免
 * 「build 悄悄写回旧版本」这种情况无从排查。
 */
export async function patchManifest(options: PatchManifestOptions): Promise<PatchManifestResult> {
    const catalog = createDependencyCatalog(options.config);

    // Reuse concrete versions already written by a previous `bepack install`.
    // Without this, a later standalone `bepack build` sees `stable` in config
    // again and incorrectly asks the user to run install a second time.
    const bpPath = options.config.packs.bp ? bpManifest(options.cwd, options.config)! : undefined;
    const bpExisting = bpPath ? await ManifestFile.read(bpPath) : undefined;
    const existingResolvedDeps = extractResolvedDependencies(bpExisting, catalog);
    const depManager = new ManifestDepManager(options.config, catalog, {
        ...(options.resolvedDeps ? { install: options.resolvedDeps } : {}),
        manifest: existingResolvedDeps,
    });
    const builder = new ManifestBuilder(options.config, depManager);

    const result: PatchManifestResult = {};

    // BP manifest
    if (options.config.packs.bp) {
        const bpExisted = bpExisting !== undefined;

        // Warn if config forces format_version 2 but existing manifest uses format 3
        if (options.config.manifestFormat === 2 && bpExisting?.format_version === 3) {
            const warn = options.logger?.warn ?? console.warn;
            warn(
                "Warning: config manifestFormat is 2, but existing manifest uses format_version 3. " +
                    "format_version 2 does not support string versions; any string versions in the existing manifest will be preserved as-is."
            );
        }

        const bpManifestObj = builder.buildBp(bpExisting);
        const dependencies: PatchedManifestDependency[] = depManager
            .getDependencyDiagnostics()
            .map((dep) => ({
                module_name: dep.name,
                specifier: dep.specifier,
                version: dep.version,
                source: dep.source,
                ...(existingResolvedDeps[dep.name] !== undefined
                    ? { previous: existingResolvedDeps[dep.name] as string }
                    : {}),
            }));
        if (!options.dryRun) await ManifestFile.write(bpPath!, bpManifestObj, "bp");
        logDependencyDecisions(dependencies, options.logger);
        result.bpManifest = {
            path: slash(path.relative(options.cwd, bpPath!)),
            updated: true,
            existed: bpExisted,
            dependencies,
        };
    }

    // RP manifest
    if (options.config.packs.rp) {
        const rpPath = rpManifest(options.cwd, options.config)!;
        const rpExisting = await ManifestFile.read(rpPath);
        const rpExisted = rpExisting !== undefined;
        const rpManifestObj = builder.buildRp(rpExisting);
        if (!options.dryRun) await ManifestFile.write(rpPath, rpManifestObj, "rp");
        result.rpManifest = {
            path: slash(path.relative(options.cwd, rpPath)),
            updated: true,
            existed: rpExisted,
        };
    }

    return result;
}

type DependencyDecision = {
    module_name: string;
    specifier: string;
    version: string;
    source: string;
    previous?: string;
};

/** 说明每条受管依赖最终写入的版本；版本变化与离线复用都显式打印。 */
function logDependencyDecisions(
    decisions: DependencyDecision[],
    logger: PatchManifestOptions["logger"]
): void {
    if (!logger) return;
    for (const dep of decisions) {
        const label = colors.cyan(dep.module_name);
        if (dep.previous !== undefined && dep.previous !== dep.version) {
            logger.info(
                `manifest   ${label}: ${dep.previous} ${colors.dim("->")} ${dep.version} ` +
                    `(specifier ${JSON.stringify(dep.specifier)}, ${dep.source})`
            );
        } else if (dep.source === "manifest") {
            logger.info(
                `manifest   ${label} ${dep.version} ${colors.dim("kept from manifest")} ` +
                    `(specifier ${JSON.stringify(dep.specifier)}) — run \`bepack install\` to refresh`
            );
        } else {
            logger.verbose(
                `manifest   ${label} ${dep.version} (specifier ${JSON.stringify(dep.specifier)}, ${dep.source})`
            );
        }
    }
}

function extractResolvedDependencies(
    manifest: Manifest | undefined,
    catalog: ReturnType<typeof createDependencyCatalog>
): Record<string, string> {
    const resolved: Record<string, string> = {};
    for (const dependency of manifest?.dependencies ?? []) {
        if (
            "module_name" in dependency &&
            typeof dependency.module_name === "string" &&
            typeof dependency.version === "string" &&
            catalog[dependency.module_name]?.manifest &&
            dependency.version !== "stable"
        ) {
            resolved[dependency.module_name] = dependency.version;
        }
    }
    return resolved;
}
