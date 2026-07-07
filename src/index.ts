export { defineConfig } from "./config/defaultConfig.js";
export { loadConfig } from "./config/loadConfig.js";
export { patchManifest } from "./manifest/patchManifest.js";
export { DependencyService, resolveDependencies } from "./install/DependencyService.js";
export { MinecraftPackageResolver } from "./install/MinecraftPackageResolver.js";
export {
    createDependencyCatalog,
    BUILTIN_DEPENDENCY_CATALOG,
} from "./install/dependencyCatalog.js";
export { NpmRegistryClient } from "./utils/npmRegistry.js";
export {
    DependencyResolverRegistry,
    BUILTIN_DEPENDENCY_RESOLVERS,
} from "./install/resolvers/minecraft.js";
export { BePackError } from "./errors/BePackError.js";
export type {
    UserConfig,
    ResolvedConfig,
    ConfigContext,
    HookContext,
    DependencyCatalogEntry,
    DependencyResolverContext,
    DependencyResolverRule,
    DependencyResolverResult,
    NpmPackageMetadata,
} from "./config/configTypes.js";
