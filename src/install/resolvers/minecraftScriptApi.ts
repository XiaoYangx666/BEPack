import { targetSupportsChannelDependency, compareLooseSemver } from "../../utils/semver.js";
import { MinecraftPackageResolver, betaVersions } from "../MinecraftPackageResolver.js";
import { BePackError } from "../../errors/BePackError.js";
import type { DependencyResolverRule } from "../../config/configTypes.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function resolveManifestVersion(packageVersion: string, target: string): string {
    if (target === "latest" || targetSupportsChannelDependency(target)) return "beta";
    const short = /^(\d+\.\d+\.\d+-beta)/i.exec(packageVersion);
    return short?.[1] ?? packageVersion;
}

/** Find the highest beta version across all versions (excluding preview builds), ignoring dist-tags. */
export function latestBetaFromAllVersions(
    packageName: string,
    versions: string[],
    logger?: { verbose: (msg: string) => void }
): string {
    const all = betaVersions(versions).filter(
        (v) => !/(?:rc|beta)\.\d+\.\d+\.\d+-preview\.\d+$/i.test(v)
    );
    const found = all.at(-1);
    if (!found) {
        throw new BePackError(
            "SAPI_VERSION_NOT_FOUND",
            `Cannot resolve latest beta version for ${packageName}.`,
            { details: { package: packageName } }
        );
    }
    logger?.verbose(`Resolved ${packageName}@beta -> ${found}`);
    return found;
}

/** Filter versions that are Script API preview builds (containing -preview.N at the end). */
function scriptApiPreviewVersions(versions: string[]): string[] {
    return versions
        .filter((v) => /(?:rc|beta)\.\d+\.\d+\.\d+-preview\.\d+$/i.test(v))
        .sort(compareLooseSemver);
}

/** Find the latest preview version overall. */
export function latestPreviewVersion(
    packageName: string,
    versions: string[],
    logger?: { verbose: (msg: string) => void }
): string {
    const all = scriptApiPreviewVersions(versions);
    const found = all.at(-1);
    if (!found) {
        throw new BePackError(
            "SAPI_VERSION_NOT_FOUND",
            `Cannot resolve latest preview version for ${packageName}.`,
            { details: { package: packageName } }
        );
    }
    logger?.verbose(`Resolved ${packageName}@preview -> ${found}`);
    return found;
}

/** Find the highest preview version matching a concrete Minecraft target (e.g. 1.26.40). */
export function previewVersionForTarget(
    packageName: string,
    versions: string[],
    target: string,
    logger?: { verbose: (msg: string) => void }
): string {
    const escaped = target.replace(/\./g, "\\.");
    const matcher = new RegExp(`(?:rc|beta)\\.${escaped}-preview\\.\\d+$`);
    const matches = versions.filter((v) => matcher.test(v)).sort(compareLooseSemver);
    const found = matches.at(-1);
    if (!found) {
        throw new BePackError(
            "SAPI_VERSION_NOT_FOUND",
            `Cannot resolve ${packageName}@preview for target ${target}.`,
            {
                details: { package: packageName, specifier: "preview", target },
                suggestions: ['Use target: "latest"', "Specify an exact version"],
            }
        );
    }
    logger?.verbose(`Resolved ${packageName}@preview for target ${target} -> ${found}`);
    return found;
}

// ---------------------------------------------------------------------------
// minecraft-script-api resolver (supports stable/beta/preview)
// ---------------------------------------------------------------------------

export const minecraftScriptApiResolver: DependencyResolverRule = {
    name: "minecraft-script-api",
    resolver: "minecraft-script-api",

    match: (ctx) =>
        ctx.specifier === "stable" || ctx.specifier === "beta" || ctx.specifier === "preview",

    async resolve(ctx) {
        const metadata = await ctx.npm.metadata(ctx.packageName);
        const pkg = new MinecraftPackageResolver(ctx.npm, ctx.logger);

        if (ctx.specifier === "stable") {
            ctx.logger?.verbose(`Resolving ${ctx.packageName}@stable for target ${ctx.target}`);
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
                manifestVersion: packageVersion,
            };
        }

        if (ctx.specifier === "beta") {
            ctx.logger?.verbose(`Resolving ${ctx.packageName}@beta for target ${ctx.target}`);
            const packageVersion =
                ctx.target === "latest"
                    ? latestBetaFromAllVersions(
                          ctx.packageName,
                          ctx.npm.versions(metadata),
                          ctx.logger
                      )
                    : pkg.betaForTarget(ctx.packageName, ctx.target, metadata);
            return {
                packageVersion,
                manifestVersion: resolveManifestVersion(packageVersion, ctx.target),
            };
        }

        // specifier === "preview" — full version string written to manifest
        ctx.logger?.verbose(`Resolving ${ctx.packageName}@preview for target ${ctx.target}`);
        const packageVersion =
            ctx.target === "latest"
                ? latestPreviewVersion(ctx.packageName, ctx.npm.versions(metadata), ctx.logger)
                : previewVersionForTarget(
                      ctx.packageName,
                      ctx.npm.versions(metadata),
                      ctx.target,
                      ctx.logger
                  );
        return {
            packageVersion,
            manifestVersion: packageVersion,
        };
    },
};
