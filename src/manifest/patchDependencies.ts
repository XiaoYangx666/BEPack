import { BePackError } from "../errors/BePackError.js";
import {
    isSpecificVersion,
    isStableApiSpecifier,
    targetSupportsChannelDependency,
} from "../utils/semver.js";
import type { ResolvedConfig } from "../config/configTypes.js";
import { createDependencyCatalog } from "../install/dependencyCatalog.js";

export type ManifestDependency = {
    module_name?: string;
    uuid?: string;
    version: string | [number, number, number];
};

export function validateManifestDependencies(config: ResolvedConfig): void {
    const catalog = createDependencyCatalog(config);
    for (const [name, specifier] of Object.entries(config.packs.bp.dependencies)) {
        const entry = catalog[name];
        if (!entry) {
            throw new BePackError(
                "UNSUPPORTED_DEPENDENCY",
                `${name} is not a managed dependency. Add it to install.dependencyCatalog or remove it from packs.bp.dependencies.`,
                { details: { package: name } }
            );
        }
        if (!isAllowedDependencySpecifier(specifier)) {
            throw new BePackError(
                "DEPENDENCY_VERSION_INVALID",
                `${name} dependency version is invalid: ${specifier}`,
                { details: { package: name, specifier } }
            );
        }
    }
    if (
        config.packs.bp.achievement &&
        !Object.values(config.packs.bp.dependencies).every(isStableApiSpecifier)
    ) {
        throw new BePackError(
            "ACHIEVEMENT_REQUIRES_STABLE_API",
            "achievement requires stable Script API dependencies."
        );
    }
}

export function isAllowedDependencySpecifier(value: string): boolean {
    return (
        value === "stable" ||
        value === "beta" ||
        value === "preview" ||
        /^\d+\.\d+\.\d+(?:[-.][0-9A-Za-z.-]+)?$/.test(value)
    );
}

export function manifestVersionFor(
    specifier: string,
    target: string,
    resolvedPackageVersion?: string
): string {
    if (specifier === "stable") {
        if (resolvedPackageVersion) return resolvedPackageVersion;
        throw new BePackError(
            "DEPENDENCY_REQUIRES_INSTALL",
            "Run `bepack install` to resolve stable manifest dependencies.",
            { details: { specifier, target } }
        );
    }
    if (specifier === "beta") {
        if (!targetSupportsChannelDependency(target)) {
            if (!resolvedPackageVersion) {
                throw new BePackError(
                    "DEPENDENCY_REQUIRES_INSTALL",
                    `Run \`bepack install\` to resolve manifest dependencies for target ${target}.`,
                    { details: { target } }
                );
            }
            return resolvedPackageVersion;
        }
        return "beta";
    }
    if (specifier === "preview") {
        if (resolvedPackageVersion) return resolvedPackageVersion;
        throw new BePackError(
            "DEPENDENCY_REQUIRES_INSTALL",
            `Run \`bepack install\` to resolve preview manifest dependencies for target ${target}.`,
            { details: { specifier, target } }
        );
    }
    return specifier;
}

export function upsertModuleDependencies(
    existing: ManifestDependency[],
    deps: Record<string, string>,
    config: ResolvedConfig,
    resolved: Record<string, string> = {}
): ManifestDependency[] {
    const catalog = createDependencyCatalog(config);
    const next = [...existing];
    for (const [name, specifier] of Object.entries(deps)) {
        const entry = catalog[name];
        // Only include dependencies marked for manifest
        if (!entry?.manifest) continue;

        const index = next.findIndex((item) => item.module_name === name);
        const existingVersion =
            index >= 0 &&
            typeof next[index]?.version === "string" &&
            isSpecificVersion(next[index].version)
                ? next[index].version
                : undefined;
        const dep = {
            module_name: name,
            version: manifestVersionFor(
                specifier,
                config.target,
                resolved[name] ?? existingVersion
            ),
        };
        if (index >= 0) next[index] = dep;
        else next.push(dep);
    }
    return next;
}

export function upsertUuidDependency(
    existing: ManifestDependency[],
    uuid: string,
    version: [number, number, number]
): ManifestDependency[] {
    const next = [...existing];
    const index = next.findIndex((item) => item.uuid === uuid);
    const entry = { uuid, version };
    if (index >= 0) next[index] = entry;
    else next.push(entry);
    return next;
}
