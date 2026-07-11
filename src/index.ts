export { defineConfig } from "./config/defaultConfig.js";
export { loadConfig } from "./config/loadConfig.js";
export { patchManifest } from "./manifest/patchManifest.js";
export { DependencyService, resolveDependencies } from "./install/DependencyService.js";
export {
    MinecraftPackageResolver,
    packageVersionForSpecifier,
} from "./install/MinecraftPackageResolver.js";
export { createDependencyCatalog } from "./install/dependencyCatalog.js";
export { BUILTIN_DEPENDENCY_CATALOG } from "./constants/dependencyCatalog.js";
export { NpmRegistryClient } from "./utils/npmRegistry.js";
export {
    DependencyResolverRegistry,
    BUILTIN_DEPENDENCY_RESOLVERS,
} from "./install/resolvers/registry.js";
export { minecraftScriptApiResolver } from "./install/resolvers/minecraftScriptApi.js";
export { minecraftScriptApiBpResolver } from "./install/resolvers/minecraftScriptApiBp.js";
export { minecraftVanillaDataResolver } from "./install/resolvers/minecraftVanillaData.js";
export { exactVersionResolver } from "./install/resolvers/exact.js";
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
    PackType,
    PackInfo,
    BpConfig,
    RpConfig,
    BpCompileOptions,
    BpCompileResolved,
} from "./config/configTypes.js";
export { getConfiguredPacks } from "./config/configTypes.js";
