import {
    MANIFEST_FORMAT_VERSION,
    MIN_ENGINE_VERSION,
    MODULE_VERSION,
    SCRIPT_ENTRY,
} from "../constants/manifest.js";
import type { ResolvedConfig } from "../config/configTypes.js";
import { parseVersionTuple } from "./version.js";
import {
    upsertModuleDependencies,
    upsertUuidDependency,
    validateManifestDependencies,
} from "./patchDependencies.js";
import type { Manifest } from "./createManifest.js";

export function patchBpManifest(
    manifest: Manifest,
    config: ResolvedConfig,
    resolvedDeps: Record<string, string> = {}
): Manifest {
    validateManifestDependencies(config);
    const version = parseVersionTuple(config.version);
    manifest.format_version = MANIFEST_FORMAT_VERSION;
    manifest.header = {
        ...(manifest.header ?? {}),
        name: config.packs.bp.name,
        ...(config.packs.bp.description !== undefined
            ? { description: config.packs.bp.description }
            : {}),
        uuid: config.packs.bp.uuid,
        version,
        min_engine_version: MIN_ENGINE_VERSION,
    };
    const modules = Array.isArray(manifest.modules)
        ? manifest.modules.filter((item: any) => item.type !== "script")
        : [];
    modules.push({
        type: "script",
        language: "javascript",
        uuid: config.packs.bp.moduleUuid,
        version: MODULE_VERSION,
        entry: SCRIPT_ENTRY,
    });
    manifest.modules = modules;
    let dependencies = upsertModuleDependencies(
        Array.isArray(manifest.dependencies) ? manifest.dependencies : [],
        config.packs.bp.dependencies,
        config,
        resolvedDeps
    );
    if (config.packs.rp)
        dependencies = upsertUuidDependency(dependencies, config.packs.rp.uuid, version);
    manifest.dependencies = dependencies;
    if (config.packs.bp.achievement) {
        manifest.metadata = { ...(manifest.metadata ?? {}), product_type: "addon" };
    }
    return manifest;
}
