import { compareLooseSemver, isSpecificVersion } from "../utils/semver.js";
import { BePackError } from "../errors/BePackError.js";
import type { LoggerLike } from "../config/configTypes.js";

type NpmPackageMetadata = {
    "dist-tags"?: Record<string, string>;
    versions?: Record<string, unknown>;
};

const metadataCache = new Map<string, NpmPackageMetadata>();

function installLog(logger: LoggerLike | undefined, message: string): void {
    if (logger?.install) logger.install(message);
    else logger?.info(`[Install] ${message}`);
}

export function packageVersionForSpecifier(specifier: string): string {
    if (specifier === "stable" || specifier === "beta") {
        throw new BePackError("DEPENDENCY_VERSION_INVALID", `${specifier} must be resolved from npm registry before writing package.json.`, { details: { specifier } });
    }
    if (isSpecificVersion(specifier)) return specifier;
    throw new BePackError("DEPENDENCY_VERSION_INVALID", `Unsupported dependency version: ${specifier}`, { details: { specifier } });
}

async function fetchMetadata(packageName: string, registry: string, logger?: LoggerLike): Promise<NpmPackageMetadata> {
    const url = `${registry.replace(/\/$/, "")}/${encodeURIComponent(packageName).replace(/^%40/, "@")}`;
    const cached = metadataCache.get(url);
    if (cached) {
        logger?.verbose(`Using cached metadata for ${packageName}`);
        return cached;
    }
    installLog(logger, `fetching ${packageName} metadata from ${registry}`);
    const response = await fetch(url);
    if (!response.ok) {
        throw new BePackError("SAPI_VERSION_NOT_FOUND", `Cannot fetch ${packageName} versions from registry.`, { details: { package: packageName, registry, status: response.status } });
    }
    const data = (await response.json()) as NpmPackageMetadata;
    metadataCache.set(url, data);
    logger?.verbose(`Fetched ${packageName} metadata (${Object.keys(data.versions ?? {}).length} versions)`);
    return data;
}

function versionsOf(data: NpmPackageMetadata): string[] {
    return Object.keys(data.versions ?? {});
}

function stableVersions(versions: string[]): string[] {
    return versions.filter((version) => /^\d+\.\d+\.\d+$/.test(version)).sort(compareLooseSemver);
}

function betaVersions(versions: string[]): string[] {
    return versions.filter((version) => /(?:^|[-.])beta(?:[-.]|$)/i.test(version)).sort(compareLooseSemver);
}

export async function resolveLatestStableVersion(packageName: string, registry: string, logger?: LoggerLike): Promise<string> {
    logger?.verbose(`Resolving ${packageName}@stable for target latest`);
    const data = await fetchMetadata(packageName, registry, logger);
    const tagged = data["dist-tags"]?.latest;
    if (tagged && /^\d+\.\d+\.\d+$/.test(tagged) && data.versions?.[tagged]) {
        logger?.verbose(`Resolved ${packageName}@stable -> ${tagged}`);
        return tagged;
    }
    const found = stableVersions(versionsOf(data)).at(-1);
    if (!found) {
        throw new BePackError("SAPI_VERSION_NOT_FOUND", `Cannot resolve latest stable version for ${packageName}.`, { details: { package: packageName } });
    }
    logger?.verbose(`Resolved ${packageName}@stable -> ${found}`);
    return found;
}

export async function resolveLatestBetaVersion(packageName: string, registry: string, logger?: LoggerLike): Promise<string> {
    logger?.verbose(`Resolving ${packageName}@beta for target latest`);
    const data = await fetchMetadata(packageName, registry, logger);
    const tagged = data["dist-tags"]?.beta;
    if (tagged && data.versions?.[tagged]) {
        logger?.verbose(`Resolved ${packageName}@beta -> ${tagged}`);
        return tagged;
    }
    const found = betaVersions(versionsOf(data)).at(-1);
    if (!found) {
        throw new BePackError("SAPI_VERSION_NOT_FOUND", `Cannot resolve latest beta version for ${packageName}.`, { details: { package: packageName } });
    }
    logger?.verbose(`Resolved ${packageName}@beta -> ${found}`);
    return found;
}

export async function resolveBetaVersionFromRegistry(packageName: string, target: string, registry: string, logger?: LoggerLike): Promise<string> {
    logger?.verbose(`Resolving ${packageName}@beta for target ${target}`);
    const data = await fetchMetadata(packageName, registry, logger);
    const versions = versionsOf(data);
    const escaped = target.replace(/\./g, "\\.");
    const matcher = new RegExp(`beta[-.]${escaped}-stable`);
    const matches = versions.filter((version) => matcher.test(version)).sort(compareLooseSemver);
    const found = matches.at(-1);
    if (!found) {
        throw new BePackError("SAPI_VERSION_NOT_FOUND", `Cannot resolve ${packageName}@beta for target ${target}.`, {
            details: { package: packageName, specifier: "beta", target },
            suggestions: ["Use target: \"latest\"", "Specify an exact version", "Update BePack", "Manually edit package.json and manifest.json"],
        });
    }
    logger?.verbose(`Resolved ${packageName}@beta for target ${target} -> ${found}`);
    return found;
}

export async function resolveStableVersionForTarget(packageName: string, target: string, registry: string, logger?: LoggerLike): Promise<string> {
    logger?.verbose(`Resolving ${packageName}@stable for target ${target}`);
    const data = await fetchMetadata(packageName, registry, logger);
    const versions = versionsOf(data);
    const beta = await resolveBetaVersionFromRegistry(packageName, target, registry, logger);
    const match = /^(\d+)\.(\d+)\.(\d+)-beta[.-]/.exec(beta);
    if (!match) {
        throw new BePackError("SAPI_VERSION_NOT_FOUND", `Cannot infer stable version from ${packageName}@${beta}.`, { details: { package: packageName, beta, target } });
    }
    const stableMajor = Number(match[1]);
    const stableMinor = Number(match[2]) - 1;
    const stablePatch = Number(match[3]);
    const stableVersion = `${stableMajor}.${stableMinor}.${stablePatch}`;
    if (stableMinor < 0 || !data.versions?.[stableVersion]) {
        throw new BePackError("SAPI_VERSION_NOT_FOUND", `Cannot confirm inferred stable version ${stableVersion} for ${packageName}.`, {
            details: { package: packageName, target, beta, inferredStable: stableVersion },
        });
    }
    logger?.verbose(`Inferred ${packageName}@stable for target ${target}: ${beta} -> ${stableVersion}`);
    return stableVersion;
}
