import { BePackError } from "../../errors/BePackError.js";
import { compareLooseSemver } from "../../utils/semver.js";
import type {
    DependencyResolverContext,
    DependencyResolverResult,
    DependencyResolverRule,
    NpmPackageMetadata,
} from "../../config/configTypes.js";

const VANILLA_DATA_STABLE = /^\d+\.\d+\.\d+$/;
const VANILLA_DATA_PREVIEW = /^\d+\.\d+\.\d+-preview\.\d+$/;

/**
 * Newest stable version at or below `target`, or `undefined` when the registry
 * has no such release.
 *
 * Minecraft ships game hotfixes (1.26.61–1.26.63) without publishing new
 * vanilla data: the data only changes when blocks/items/entities change, so
 * releases such as 1.26.60 remain the newest data for those targets.
 */
function newestStableAtOrBelow(versions: string[], target: string): string | undefined {
    return versions
        .filter((version) => VANILLA_DATA_STABLE.test(version))
        .filter((version) => compareLooseSemver(version, target) <= 0)
        .sort(compareLooseSemver)
        .at(-1);
}

// ---------------------------------------------------------------------------
// minecraft-vanilla-data resolver
// ---------------------------------------------------------------------------

export const minecraftVanillaDataResolver: DependencyResolverRule = {
    name: "minecraft-vanilla-data",
    resolver: "minecraft-vanilla-data",

    match: (ctx) => ctx.specifier === "stable" || ctx.specifier === "preview",

    async resolve(ctx) {
        const metadata = await ctx.npm.metadata(ctx.packageName);

        if (ctx.specifier === "stable") {
            return resolveStable(ctx, metadata);
        }

        // specifier === "preview"
        return resolvePreview(ctx, metadata);
    },
};

function resolveStable(
    ctx: DependencyResolverContext,
    metadata: NpmPackageMetadata
): DependencyResolverResult {
    ctx.logger?.verbose(`Resolving ${ctx.packageName}@stable for target ${ctx.target}`);

    if (ctx.target === "latest") {
        // Try dist-tag "latest" first
        const tagged = ctx.npm.distTag(metadata, "latest");
        if (tagged && VANILLA_DATA_STABLE.test(tagged)) {
            ctx.logger?.verbose(`Resolved ${ctx.packageName}@stable -> ${tagged}`);
            return { packageVersion: tagged };
        }
        // Fall back to highest stable version
        const versions = ctx.npm
            .versions(metadata)
            .filter((v) => VANILLA_DATA_STABLE.test(v))
            .sort(compareLooseSemver);
        const found = versions.at(-1);
        if (!found) {
            throw new BePackError(
                "SAPI_VERSION_NOT_FOUND",
                `Cannot resolve latest stable version for ${ctx.packageName}.`,
                { details: { package: ctx.packageName } }
            );
        }
        ctx.logger?.verbose(`Resolved ${ctx.packageName}@stable -> ${found}`);
        return { packageVersion: found };
    }

    // Concrete target: try exact match
    if (metadata.versions?.[ctx.target]) {
        ctx.logger?.verbose(
            `Resolved ${ctx.packageName}@stable for target ${ctx.target} -> ${ctx.target}`
        );
        return { packageVersion: ctx.target };
    }

    // Hotfix targets usually have no vanilla-data release of their own. Use the
    // newest data at or below the target instead of failing the whole install;
    // older data still describes everything the target game version has.
    const fallback = VANILLA_DATA_STABLE.test(ctx.target)
        ? newestStableAtOrBelow(ctx.npm.versions(metadata), ctx.target)
        : undefined;
    if (fallback) {
        ctx.logger?.warn(
            `${ctx.packageName} has no stable release for target ${ctx.target}; using ${fallback} ` +
                "(newest stable release at or below the target). Pin an exact version to override."
        );
        return { packageVersion: fallback };
    }

    throw new BePackError(
        "SAPI_VERSION_NOT_FOUND",
        `Cannot resolve ${ctx.packageName}@stable for target ${ctx.target}. The target version does not exist in the registry and no older stable release is available.`,
        {
            details: { package: ctx.packageName, specifier: "stable", target: ctx.target },
            suggestions: ['Use target: "latest"', "Specify an exact version"],
        }
    );
}

function resolvePreview(
    ctx: DependencyResolverContext,
    metadata: NpmPackageMetadata
): DependencyResolverResult {
    ctx.logger?.verbose(`Resolving ${ctx.packageName}@preview for target ${ctx.target}`);

    if (ctx.target === "latest") {
        const versions = ctx.npm
            .versions(metadata)
            .filter((v) => VANILLA_DATA_PREVIEW.test(v))
            .sort(compareLooseSemver);
        const found = versions.at(-1);
        if (!found) {
            throw new BePackError(
                "SAPI_VERSION_NOT_FOUND",
                `Cannot resolve latest preview version for ${ctx.packageName}.`,
                { details: { package: ctx.packageName } }
            );
        }
        ctx.logger?.verbose(`Resolved ${ctx.packageName}@preview -> ${found}`);
        return { packageVersion: found };
    }

    // Concrete target: find highest preview matching the target prefix
    const escaped = ctx.target.replace(/\./g, "\\.");
    const matcher = new RegExp(`^${escaped}-preview\\.\\d+$`);
    const versions = ctx.npm
        .versions(metadata)
        .filter((v) => matcher.test(v))
        .sort(compareLooseSemver);
    const found = versions.at(-1);
    if (!found) {
        throw new BePackError(
            "SAPI_VERSION_NOT_FOUND",
            `Cannot resolve ${ctx.packageName}@preview for target ${ctx.target}. No matching preview version found.`,
            {
                details: { package: ctx.packageName, specifier: "preview", target: ctx.target },
                suggestions: ['Use target: "latest"', "Specify an exact preview version"],
            }
        );
    }
    ctx.logger?.verbose(`Resolved ${ctx.packageName}@preview for target ${ctx.target} -> ${found}`);
    return { packageVersion: found };
}
