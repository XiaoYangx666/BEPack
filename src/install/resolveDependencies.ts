import { isManifestDependency, isPackageOnlyDependency } from "../constants/packages.js";
import type { DependencyResolverContext, DependencyResolverRule, ResolvedConfig } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { packageVersionForSpecifier, resolveBetaVersionFromRegistry, resolveLatestBetaVersion, resolveLatestStableVersion, resolveStableVersionForTarget } from "./resolveMinecraftPackage.js";
import { targetSupportsChannelDependency } from "../utils/semver.js";
import type { LoggerLike } from "../config/configTypes.js";

function installLog(logger: LoggerLike | undefined, message: string): void {
    if (logger?.install) logger.install(message);
    else logger?.info(`[Install] ${message}`);
}

export type ResolvedDependency = {
    kind: "manifest" | "package";
    specifier: string;
    packageVersion: string;
    manifestVersion: string | null;
};

function resolveManifestVersion(specifier: string, packageVersion: string, target: string): string {
    if (specifier === "stable") return packageVersion;
    if (specifier === "beta") return target === "latest" || targetSupportsChannelDependency(target) ? "beta" : packageVersion;
    return specifier;
}

const BUILTIN_DEPENDENCY_RESOLVERS: DependencyResolverRule[] = [
    {
        name: "minecraft-stable",
        match: (ctx) => ctx.specifier === "stable",
        async resolve(ctx) {
            const packageVersion = ctx.target === "latest" ? await resolveLatestStableVersion(ctx.packageName, ctx.registry, ctx.logger) : await resolveStableVersionForTarget(ctx.packageName, ctx.target, ctx.registry, ctx.logger);
            return {
                packageVersion,
                manifestVersion: ctx.kind === "manifest" ? packageVersion : null,
            };
        },
    },
    {
        name: "minecraft-beta",
        match: (ctx) => ctx.specifier === "beta",
        async resolve(ctx) {
            const packageVersion = ctx.target === "latest" ? await resolveLatestBetaVersion(ctx.packageName, ctx.registry, ctx.logger) : await resolveBetaVersionFromRegistry(ctx.packageName, ctx.target, ctx.registry, ctx.logger);
            return {
                packageVersion,
                manifestVersion: ctx.kind === "manifest" ? resolveManifestVersion(ctx.specifier, packageVersion, ctx.target) : null,
            };
        },
    },
    {
        name: "exact-version",
        match: (ctx) => /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(ctx.specifier),
        resolve(ctx) {
            ctx.logger?.verbose(`Using exact ${ctx.packageName}@${ctx.specifier}`);
            return {
                packageVersion: packageVersionForSpecifier(ctx.specifier),
                manifestVersion: ctx.kind === "manifest" ? ctx.specifier : null,
            };
        },
    },
];

async function resolveWithRules(ctx: DependencyResolverContext) {
    const rules = [...ctx.config.install.dependencyResolvers, ...BUILTIN_DEPENDENCY_RESOLVERS];
    const rule = rules.find((candidate) => candidate.match(ctx));
    if (!rule) {
        throw new BePackError("DEPENDENCY_VERSION_INVALID", `${ctx.packageName} dependency version is invalid: ${ctx.specifier}`, { details: { package: ctx.packageName, specifier: ctx.specifier } });
    }
    ctx.logger?.verbose(`Resolving ${ctx.packageName}@${ctx.specifier} with ${rule.name}`);
    return await rule.resolve(ctx);
}

async function resolveOne(config: ResolvedConfig, logger: LoggerLike | undefined, name: string, specifier: string, kind: "manifest" | "package"): Promise<ResolvedDependency> {
    const resolved = await resolveWithRules({
        packageName: name,
        specifier,
        kind,
        target: config.target,
        registry: config.install.registry,
        config,
        ...(logger ? { logger } : {}),
    });
    return {
        kind,
        specifier,
        packageVersion: resolved.packageVersion,
        manifestVersion: kind === "manifest" ? (resolved.manifestVersion ?? resolved.packageVersion) : null,
    };
}

export async function resolveDependencies(config: ResolvedConfig, logger?: LoggerLike): Promise<Record<string, ResolvedDependency>> {
    const result: Record<string, ResolvedDependency> = {};
    installLog(logger, `resolving dependencies for target ${config.target}`);
    for (const [name, specifier] of Object.entries(config.packs.bp.dependencies)) {
        if (!isManifestDependency(name)) {
            throw new BePackError("UNSUPPORTED_MANIFEST_DEPENDENCY", `${name} is not a manifest dependency managed by BePack. Use install.dependencies or package.json instead.`);
        }
        const resolved = await resolveOne(config, logger, name, specifier, "manifest");
        installLog(logger, `${name}: ${specifier} -> package ${resolved.packageVersion}, manifest ${resolved.manifestVersion}`);
        result[name] = resolved;
    }
    for (const [name, specifier] of Object.entries(config.install.dependencies)) {
        if (!isPackageOnlyDependency(name)) {
            throw new BePackError("UNSUPPORTED_PACKAGE_DEPENDENCY", `${name} is not a package-only dependency managed by BePack. Maintain it in package.json instead.`);
        }
        const resolved = await resolveOne(config, logger, name, specifier, "package");
        installLog(logger, `${name}: ${specifier} -> package ${resolved.packageVersion}`);
        result[name] = resolved;
    }
    logger?.verbose("Dependency resolution complete");
    return result;
}
