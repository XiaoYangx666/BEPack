import type { DependencySpecifier, LoggerLike, ResolvedConfig } from "../config/configTypes.js";
import { createDependencyCatalog, getDependencyCatalogEntry } from "./dependencyCatalog.js";
import { NpmRegistryClient } from "../utils/npmRegistry.js";
import { DependencyResolverRegistry } from "./resolvers/registry.js";
import { MinecraftPackageResolver } from "./MinecraftPackageResolver.js";

export type ResolvedDependency = {
    specifier: string;
    packageVersion: string;
    manifestVersion: string | null;
    manifest: boolean;
    external: boolean;
    resolver: string;
};

type InstallLogFn = (message: string) => void;

function installLog(logger: LoggerLike | undefined): InstallLogFn {
    return (message) => {
        if (logger?.install) logger.install(message);
        else logger?.info(`[Install] ${message}`);
    };
}

export class DependencyService {
    readonly npm: NpmRegistryClient;
    readonly catalog: ReturnType<typeof createDependencyCatalog>;
    readonly pkgResolver: MinecraftPackageResolver;
    private readonly log: InstallLogFn;

    constructor(
        readonly config: ResolvedConfig,
        readonly logger?: LoggerLike
    ) {
        this.npm = new NpmRegistryClient(config.install.registry, logger);
        this.catalog = createDependencyCatalog(config);
        this.pkgResolver = new MinecraftPackageResolver(this.npm, logger);
        this.log = installLog(logger);
    }

    /**
     * Resolve all managed dependencies from packs.bp.dependencies.
     * Returns a map of package name to ResolvedDependency.
     */
    async resolveAll(): Promise<Record<string, ResolvedDependency>> {
        const result: Record<string, ResolvedDependency> = {};

        this.log(`resolving dependencies for target ${this.config.target}`);

        for (const [name, specifier] of Object.entries(this.config.packs.bp.dependencies)) {
            const entry = getDependencyCatalogEntry(this.catalog, name);
            const resolved = await this.resolveOne(name, specifier, entry);
            const manifest = entry.manifest ?? false;
            result[name] = {
                specifier,
                packageVersion: resolved.packageVersion,
                manifestVersion: manifest
                    ? (resolved.manifestVersion ?? resolved.packageVersion)
                    : null,
                manifest,
                external: manifest,
                resolver: entry.resolver,
            };
            this.log(
                `${name}: ${specifier} -> package ${result[name].packageVersion}, manifest ${result[name].manifestVersion}`
            );
        }

        this.logger?.verbose("Dependency resolution complete");
        return result;
    }

    /**
     * Resolve a single dependency to a concrete version.
     */
    async resolveOne(
        packageName: string,
        specifier: DependencySpecifier,
        entry: { resolver: string; packageJson?: boolean; manifest?: boolean }
    ): Promise<{ packageVersion: string; manifestVersion?: string | null }> {
        const registry = DependencyResolverRegistry.fromConfig(
            this.config.install.dependencyResolvers
        );
        return await registry.resolve({
            packageName,
            specifier,
            target: this.config.target,
            entry,
            config: this.config,
            npm: this.npm,
            ...(this.logger ? { logger: this.logger } : {}),
        });
    }
}

/** @deprecated Use `new DependencyService(config, logger).resolveAll()` instead. */
export async function resolveDependencies(
    config: ResolvedConfig,
    logger?: LoggerLike
): Promise<Record<string, ResolvedDependency>> {
    return new DependencyService(config, logger).resolveAll();
}
