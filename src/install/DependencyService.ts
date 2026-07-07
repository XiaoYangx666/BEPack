import type {
    DependencyKind,
    DependencySpecifier,
    LoggerLike,
    ResolvedConfig,
} from "../config/configTypes.js";
import { createDependencyCatalog, getDependencyCatalogEntry } from "./dependencyCatalog.js";
import { NpmRegistryClient } from "../utils/npmRegistry.js";
import { DependencyResolverRegistry } from "./resolvers/minecraft.js";
import { MinecraftPackageResolver } from "./MinecraftPackageResolver.js";

export type ResolvedDependency = {
    kind: DependencyKind;
    specifier: string;
    packageVersion: string;
    manifestVersion: string | null;
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
     * Resolve all managed dependencies from the config.
     * Returns a map of package name to ResolvedDependency.
     */
    async resolveAll(): Promise<Record<string, ResolvedDependency>> {
        const result: Record<string, ResolvedDependency> = {};

        this.log(`resolving dependencies for target ${this.config.target}`);

        // manifest-level dependencies (bp config)
        for (const [name, specifier] of Object.entries(this.config.packs.bp.dependencies)) {
            const entry = getDependencyCatalogEntry(this.catalog, name, "manifest");
            const resolved = await this.resolveOne(name, specifier, entry.kind, entry);
            this.log(
                `${name}: ${specifier} -> package ${resolved.packageVersion}, manifest ${resolved.manifestVersion}`
            );
            result[name] = resolved;
        }

        // package-only dependencies (install config)
        for (const [name, specifier] of Object.entries(this.config.install.dependencies)) {
            const entry = getDependencyCatalogEntry(this.catalog, name, "package");
            const resolved = await this.resolveOne(name, specifier, entry.kind, entry);
            this.log(`${name}: ${specifier} -> package ${resolved.packageVersion}`);
            result[name] = resolved;
        }

        this.logger?.verbose("Dependency resolution complete");
        return result;
    }

    /**
     * Resolve a single dependency to a concrete version.
     * Only the 4 parameters that vary per dependency need to be passed.
     */
    async resolveOne(
        packageName: string,
        specifier: DependencySpecifier,
        kind: DependencyKind,
        entry: { kind: DependencyKind; resolver?: string }
    ): Promise<ResolvedDependency> {
        const registry = DependencyResolverRegistry.fromConfig(
            this.config.install.dependencyResolvers
        );
        const resolved = await registry.resolve({
            packageName,
            specifier,
            kind,
            package: entry,
            target: this.config.target,
            registry: this.config.install.registry,
            config: this.config,
            npm: this.npm,
            ...(this.logger ? { logger: this.logger } : {}),
        });
        return {
            kind,
            specifier,
            packageVersion: resolved.packageVersion,
            manifestVersion:
                kind === "manifest" ? (resolved.manifestVersion ?? resolved.packageVersion) : null,
        };
    }
}

/** @deprecated Use `new DependencyService(config, logger).resolveAll()` instead. */
export async function resolveDependencies(
    config: ResolvedConfig,
    logger?: LoggerLike
): Promise<Record<string, ResolvedDependency>> {
    return new DependencyService(config, logger).resolveAll();
}
