import path from "node:path";
import { bpManifest, rpManifest, slash } from "../utils/path.js";
import { createDependencyCatalog } from "../install/dependencyCatalog.js";
import type { ResolvedConfig, LoggerLike } from "../config/configTypes.js";
import { ManifestFile } from "./ManifestFile.js";
import { ManifestBuilder } from "./ManifestBuilder.js";
import { ManifestDepManager } from "./ManifestDepManager.js";
import type { Manifest } from "./types.js";

export type PatchManifestOptions = {
    cwd: string;
    config: ResolvedConfig;
    dryRun?: boolean;
    resolvedDeps?: Record<string, string>;
    logger?: LoggerLike;
};

/**
 * 修补 BP 和/或 RP manifest 文件。
 *
 * - 只负责任务编排：路径计算、文件读写、调用构建器和依赖管理器。
 * - 如果 manifest 已存在，保留用户手写字段并覆盖 BePack 管理字段。
 * - 如果 manifest 不存在，根据配置完整生成。
 * - dryRun 时返回结果但不写入文件。
 * - 只修补已配置的 Pack（至少一个必须存在）。
 */
export async function patchManifest(options: PatchManifestOptions) {
    const catalog = createDependencyCatalog(options.config);

    // Reuse concrete versions already written by a previous `bepack install`.
    // Without this, a later standalone `bepack build` sees `stable` in config
    // again and incorrectly asks the user to run install a second time.
    const bpPath = options.config.packs.bp ? bpManifest(options.cwd, options.config)! : undefined;
    const bpExisting = bpPath ? await ManifestFile.read(bpPath) : undefined;
    const existingResolvedDeps = extractResolvedDependencies(bpExisting, catalog);
    const depManager = new ManifestDepManager(
        options.config,
        catalog,
        options.resolvedDeps
            ? { ...existingResolvedDeps, ...options.resolvedDeps }
            : existingResolvedDeps
    );
    const builder = new ManifestBuilder(options.config, depManager);

    const result: Record<string, { path: string; updated: boolean; existed: boolean }> = {};

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
        if (!options.dryRun) await ManifestFile.write(bpPath!, bpManifestObj, "bp");
        result.bpManifest = {
            path: slash(path.relative(options.cwd, bpPath!)),
            updated: true,
            existed: bpExisted,
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
