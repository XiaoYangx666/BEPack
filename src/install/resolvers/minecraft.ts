import { BePackError } from "../../errors/BePackError.js";
import { targetSupportsChannelDependency } from "../../utils/semver.js";
import {
    packageVersionForSpecifier,
    MinecraftPackageResolver,
} from "../MinecraftPackageResolver.js";
import type {
    DependencyResolverContext,
    DependencyResolverResult,
    DependencyResolverRule,
} from "../../config/configTypes.js";

// ---------------------------------------------------------------------------
// minecraft-stable
// ---------------------------------------------------------------------------

export const minecraftStableResolver: DependencyResolverRule = {
    name: "minecraft-stable",
    resolver: "minecraft",
    match: (ctx) => ctx.specifier === "stable",
    async resolve(ctx) {
        ctx.logger?.verbose(`Resolving ${ctx.packageName}@stable for target ${ctx.target}`);
        const metadata = await ctx.npm.metadata(ctx.packageName);
        const pkg = new MinecraftPackageResolver(ctx.npm, ctx.logger);
        const packageVersion =
            ctx.target === "latest"
                ? pkg.latestStable(ctx.packageName, metadata)
                : pkg.inferStableFromBeta(
                      ctx.packageName,
                      ctx.target,
                      pkg.betaForTarget(ctx.packageName, ctx.target, metadata),
                      metadata
                  );
        return {
            packageVersion,
            manifestVersion: ctx.kind === "manifest" ? packageVersion : null,
        };
    },
};

// ---------------------------------------------------------------------------
// minecraft-beta
// ---------------------------------------------------------------------------

function resolveManifestVersion(packageVersion: string, target: string): string {
    if (target === "latest" || targetSupportsChannelDependency(target)) return "beta";
    const short = /^(\d+\.\d+\.\d+-beta)/i.exec(packageVersion);
    return short?.[1] ?? packageVersion;
}

export const minecraftBetaResolver: DependencyResolverRule = {
    name: "minecraft-beta",
    resolver: "minecraft",
    match: (ctx) => ctx.specifier === "beta",
    async resolve(ctx) {
        ctx.logger?.verbose(`Resolving ${ctx.packageName}@beta for target ${ctx.target}`);
        const metadata = await ctx.npm.metadata(ctx.packageName);
        const pkg = new MinecraftPackageResolver(ctx.npm, ctx.logger);
        const packageVersion =
            ctx.target === "latest"
                ? pkg.latestBeta(ctx.packageName, metadata)
                : pkg.betaForTarget(ctx.packageName, ctx.target, metadata);
        return {
            packageVersion,
            manifestVersion:
                ctx.kind === "manifest" ? resolveManifestVersion(packageVersion, ctx.target) : null,
        };
    },
};

// ---------------------------------------------------------------------------
// exact-version
// ---------------------------------------------------------------------------

export const exactVersionResolver: DependencyResolverRule = {
    name: "exact-version",
    match: (ctx) => /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(ctx.specifier),
    resolve(ctx) {
        ctx.logger?.verbose(`Using exact ${ctx.packageName}@${ctx.specifier}`);
        return {
            packageVersion: packageVersionForSpecifier(ctx.specifier),
            manifestVersion: ctx.kind === "manifest" ? ctx.specifier : null,
        };
    },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const BUILTIN_DEPENDENCY_RESOLVERS: DependencyResolverRule[] = [
    minecraftStableResolver,
    minecraftBetaResolver,
    exactVersionResolver,
];

export class DependencyResolverRegistry {
    constructor(private readonly resolvers: DependencyResolverRule[]) {}

    static fromConfig(customResolvers: DependencyResolverRule[]): DependencyResolverRegistry {
        return new DependencyResolverRegistry([
            ...customResolvers,
            ...BUILTIN_DEPENDENCY_RESOLVERS,
        ]);
    }

    private resolverMatchesCatalog(
        ctx: DependencyResolverContext,
        rule: DependencyResolverRule
    ): boolean {
        const selected = ctx.package.resolver;
        if (!selected) return true;
        return rule.resolver === undefined || rule.resolver === selected || rule.name === selected;
    }

    find(ctx: DependencyResolverContext): DependencyResolverRule {
        const rule = this.resolvers.find(
            (candidate) => this.resolverMatchesCatalog(ctx, candidate) && candidate.match(ctx)
        );
        if (!rule) {
            throw new BePackError(
                "DEPENDENCY_VERSION_INVALID",
                `${ctx.packageName} dependency version is invalid: ${ctx.specifier}`,
                {
                    details: {
                        package: ctx.packageName,
                        specifier: ctx.specifier,
                        resolver: ctx.package.resolver,
                    },
                }
            );
        }
        ctx.logger?.verbose(`Resolving ${ctx.packageName}@${ctx.specifier} with ${rule.name}`);
        return rule;
    }

    async resolve(ctx: DependencyResolverContext): Promise<DependencyResolverResult> {
        return await this.find(ctx).resolve(ctx);
    }
}
