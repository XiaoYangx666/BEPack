import type { DependencyCatalogEntry, ResolvedConfig } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { minecraftScriptApiResolver } from "./resolvers/minecraftScriptApi.js";
import { minecraftScriptApiBpResolver } from "./resolvers/minecraftScriptApiBp.js";
import { minecraftVanillaDataResolver } from "./resolvers/minecraftVanillaData.js";

export const BUILTIN_DEPENDENCY_CATALOG: Record<string, DependencyCatalogEntry> = {
    "@minecraft/server": {
        resolver: minecraftScriptApiResolver,
        manifest: true,
    },
    "@minecraft/server-ui": {
        resolver: minecraftScriptApiResolver,
        manifest: true,
    },
    "@minecraft/server-net": {
        resolver: minecraftScriptApiBpResolver,
        manifest: true,
    },
    "@minecraft/server-admin": {
        resolver: minecraftScriptApiBpResolver,
        manifest: true,
    },
    "@minecraft/server-gametest": {
        resolver: minecraftScriptApiBpResolver,
        manifest: true,
    },
    "@minecraft/debug-utilities": {
        resolver: minecraftScriptApiBpResolver,
        manifest: true,
    },
    "@minecraft/vanilla-data": {
        resolver: minecraftVanillaDataResolver,
        manifest: false,
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
