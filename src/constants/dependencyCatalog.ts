import type { DependencyCatalogEntry } from "../config/configTypes.js";
import { minecraftScriptApiResolver } from "../install/resolvers/minecraftScriptApi.js";
import { minecraftScriptApiBpResolver } from "../install/resolvers/minecraftScriptApiBp.js";
import { minecraftVanillaDataResolver } from "../install/resolvers/minecraftVanillaData.js";

/** Built-in managed dependency catalog. Maps package names to resolver + manifest behavior. */
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
