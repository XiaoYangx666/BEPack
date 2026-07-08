import { compareLooseSemver, isSpecificVersion } from "../utils/semver.js";
import { BePackError } from "../errors/BePackError.js";
import type { LoggerLike, NpmPackageMetadata } from "../config/configTypes.js";
import type { NpmRegistryClient } from "../utils/npmRegistry.js";

// ---------------------------------------------------------------------------
// Static / pure utilities
// ---------------------------------------------------------------------------

export function packageVersionForSpecifier(specifier: string): string {
    if (specifier === "stable" || specifier === "beta" || specifier === "preview") {
        throw new BePackError(
            "DEPENDENCY_VERSION_INVALID",
            `${specifier} must be resolved from npm registry before writing package.json.`,
            { details: { specifier } }
        );
    }
    if (isSpecificVersion(specifier)) return specifier;
    throw new BePackError(
        "DEPENDENCY_VERSION_INVALID",
        `Unsupported dependency version: ${specifier}`,
        { details: { specifier } }
    );
}

export function stableVersions(versions: string[]): string[] {
    return versions.filter((version) => /^\d+\.\d+\.\d+$/.test(version)).sort(compareLooseSemver);
}

export function betaVersions(versions: string[]): string[] {
    return versions
        .filter((version) => /(?:^|[-.])beta(?:[-.]|$)/i.test(version))
        .sort(compareLooseSemver);
}

// ---------------------------------------------------------------------------
// Instance-based resolver (npm + logger on this)
// ---------------------------------------------------------------------------

export class MinecraftPackageResolver {
    constructor(
        private readonly npm: NpmRegistryClient,
        private readonly logger?: LoggerLike
    ) {}

    /** Resolve latest stable version from metadata, using dist-tag "latest" or falling back to highest stable. */
    latestStable(packageName: string, metadata: NpmPackageMetadata): string {
        const tagged = this.npm.distTag(metadata, "latest");
        if (tagged && /^\d+\.\d+\.\d+$/.test(tagged)) {
            this.logger?.verbose(`Resolved ${packageName}@stable -> ${tagged}`);
            return tagged;
        }
        const found = stableVersions(this.npm.versions(metadata)).at(-1);
        if (!found) {
            throw new BePackError(
                "SAPI_VERSION_NOT_FOUND",
                `Cannot resolve latest stable version for ${packageName}.`,
                { details: { package: packageName } }
            );
        }
        this.logger?.verbose(`Resolved ${packageName}@stable -> ${found}`);
        return found;
    }

    /** Resolve latest beta version from metadata, using dist-tag "beta" or falling back to highest beta. */
    latestBeta(packageName: string, metadata: NpmPackageMetadata): string {
        const tagged = this.npm.distTag(metadata, "beta");
        if (tagged) {
            this.logger?.verbose(`Resolved ${packageName}@beta -> ${tagged}`);
            return tagged;
        }
        const found = betaVersions(this.npm.versions(metadata)).at(-1);
        if (!found) {
            throw new BePackError(
                "SAPI_VERSION_NOT_FOUND",
                `Cannot resolve latest beta version for ${packageName}.`,
                { details: { package: packageName } }
            );
        }
        this.logger?.verbose(`Resolved ${packageName}@beta -> ${found}`);
        return found;
    }

    /** Resolve the highest beta version matching a concrete Minecraft target (e.g. 1.21.120). */
    betaForTarget(packageName: string, target: string, metadata: NpmPackageMetadata): string {
        const escaped = target.replace(/\./g, "\\.");
        const matcher = new RegExp(`beta[-.]${escaped}-stable`);
        const matches = this.npm
            .versions(metadata)
            .filter((version) => matcher.test(version))
            .sort(compareLooseSemver);
        const found = matches.at(-1);
        if (!found) {
            throw new BePackError(
                "SAPI_VERSION_NOT_FOUND",
                `Cannot resolve ${packageName}@beta for target ${target}.`,
                {
                    details: { package: packageName, specifier: "beta", target },
                    suggestions: [
                        'Use target: "latest"',
                        "Specify an exact version",
                        "Update BePack",
                        "Manually edit package.json and manifest.json",
                    ],
                }
            );
        }
        this.logger?.verbose(`Resolved ${packageName}@beta for target ${target} -> ${found}`);
        return found;
    }

    /** Infer the concurrent stable version from a beta version string. */
    inferStableFromBeta(
        packageName: string,
        target: string,
        beta: string,
        metadata: NpmPackageMetadata
    ): string {
        const match = /^(\d+)\.(\d+)\.(\d+)-beta[.-]/.exec(beta);
        if (!match) {
            throw new BePackError(
                "SAPI_VERSION_NOT_FOUND",
                `Cannot infer stable version from ${packageName}@${beta}.`,
                { details: { package: packageName, beta, target } }
            );
        }
        const stableMajor = Number(match[1]);
        const stableMinor = Number(match[2]) - 1;
        const stablePatch = Number(match[3]);
        const stableVersion = `${stableMajor}.${stableMinor}.${stablePatch}`;
        if (stableMinor < 0 || !metadata.versions?.[stableVersion]) {
            throw new BePackError(
                "SAPI_VERSION_NOT_FOUND",
                `Cannot confirm inferred stable version ${stableVersion} for ${packageName}.`,
                {
                    details: { package: packageName, target, beta, inferredStable: stableVersion },
                }
            );
        }
        return stableVersion;
    }
}
