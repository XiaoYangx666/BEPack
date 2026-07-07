import {
    MANIFEST_FORMAT_VERSION,
    MIN_ENGINE_VERSION,
    MODULE_VERSION,
    SCRIPT_ENTRY,
} from "../constants/manifest.js";
import type { ResolvedConfig } from "../config/configTypes.js";
import { parseVersionTuple } from "./version.js";

export type Manifest = Record<string, any>;

export function createBpManifest(config: ResolvedConfig): Manifest {
    return {
        format_version: MANIFEST_FORMAT_VERSION,
        header: {
            name: config.packs.bp.name,
            ...(config.packs.bp.description !== undefined
                ? { description: config.packs.bp.description }
                : {}),
            uuid: config.packs.bp.uuid,
            version: parseVersionTuple(config.version),
            min_engine_version: MIN_ENGINE_VERSION,
        },
        modules: [
            {
                type: "script",
                language: "javascript",
                uuid: config.packs.bp.moduleUuid,
                version: MODULE_VERSION,
                entry: SCRIPT_ENTRY,
            },
        ],
        dependencies: [],
    };
}

export function createRpManifest(config: ResolvedConfig): Manifest {
    const rp = config.packs.rp;
    if (!rp) return {};
    return {
        format_version: MANIFEST_FORMAT_VERSION,
        header: {
            name: rp.name,
            ...(rp.description !== undefined ? { description: rp.description } : {}),
            uuid: rp.uuid,
            version: parseVersionTuple(config.version),
            min_engine_version: MIN_ENGINE_VERSION,
        },
        modules: [
            {
                type: "resources",
                uuid: rp.moduleUuid,
                version: MODULE_VERSION,
            },
        ],
        dependencies: [],
    };
}
