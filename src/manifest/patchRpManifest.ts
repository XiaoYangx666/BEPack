import {
    MANIFEST_FORMAT_VERSION,
    MIN_ENGINE_VERSION,
    MODULE_VERSION,
} from "../constants/manifest.js";
import type { ResolvedConfig } from "../config/configTypes.js";
import { parseVersionTuple } from "./version.js";
import { upsertUuidDependency } from "./patchDependencies.js";
import type { Manifest } from "./createManifest.js";

export function patchRpManifest(manifest: Manifest, config: ResolvedConfig): Manifest {
    const rp = config.packs.rp;
    if (!rp) return manifest;
    const version = parseVersionTuple(config.version);
    manifest.format_version = MANIFEST_FORMAT_VERSION;
    manifest.header = {
        ...(manifest.header ?? {}),
        name: rp.name,
        ...(rp.description !== undefined ? { description: rp.description } : {}),
        uuid: rp.uuid,
        version,
        min_engine_version: MIN_ENGINE_VERSION,
    };
    const modules = Array.isArray(manifest.modules)
        ? manifest.modules.filter((item: any) => item.type !== "resources")
        : [];
    modules.push({ type: "resources", uuid: rp.moduleUuid, version: MODULE_VERSION });
    manifest.modules = modules;
    manifest.dependencies = upsertUuidDependency(
        Array.isArray(manifest.dependencies) ? manifest.dependencies : [],
        config.packs.bp.uuid,
        version
    );
    if (rp.pbr === true) {
        const capabilities = Array.isArray(manifest.capabilities) ? manifest.capabilities : [];
        manifest.capabilities = capabilities.includes("pbr")
            ? capabilities
            : [...capabilities, "pbr"];
    } else if (rp.pbr === false) {
        if (Array.isArray(manifest.capabilities)) {
            manifest.capabilities = manifest.capabilities.filter((c: string) => c !== "pbr");
            if (manifest.capabilities.length === 0) delete manifest.capabilities;
        }
    }
    return manifest;
}
