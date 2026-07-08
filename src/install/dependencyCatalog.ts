import type { DependencyCatalogEntry, ResolvedConfig } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";

export const BUILTIN_DEPENDENCY_CATALOG: Record<string, DependencyCatalogEntry> = {
    "@minecraft/server": {
        resolver: "minecraft-script-api",
        manifest: true,
    },
    "@minecraft/server-ui": {
        resolver: "minecraft-script-api",
        manifest: true,
    },
    "@minecraft/server-net": {
        resolver: "minecraft-script-api-bp",
        manifest: true,
    },
    "@minecraft/server-admin": {
        resolver: "minecraft-script-api-bp",
        manifest: true,
    },
    "@minecraft/server-gametest": {
        resolver: "minecraft-script-api-bp",
        manifest: true,
    },
    "@minecraft/vanilla-data": {
        resolver: "minecraft-vanilla-data",
        manifest: false,
    },
    "@minecraft/debug-utilities": {
        resolver: "minecraft-vanilla-data",
        manifest: true,
    },
};

export function createDependencyCatalog(
    config: ResolvedConfig
): Record<string, DependencyCatalogEntry> {
    return {
        ...BUILTIN_DEPENDENCY_CATALOG,
        ...config.install.dependencyCatalog,
    };
}

export function getDependencyCatalogEntry(
    catalog: Record<string, DependencyCatalogEntry>,
    packageName: string
): DependencyCatalogEntry {
    const entry = catalog[packageName];
    if (!entry) {
        throw new BePackError(
            "UNSUPPORTED_DEPENDENCY",
            `${packageName} is not a managed dependency. Add it to install.dependencyCatalog or remove it from packs.bp.dependencies.`,
            { details: { package: packageName } }
        );
    }
    return entry;
}
