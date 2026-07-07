import { BUILTIN_DEPENDENCY_CATALOG } from "../install/dependencyCatalog.js";

export const MANIFEST_DEPENDENCIES = Object.entries(BUILTIN_DEPENDENCY_CATALOG)
    .filter(([, entry]) => entry.kind === "manifest")
    .map(([name]) => name);

export const PACKAGE_ONLY_DEPENDENCIES = Object.entries(BUILTIN_DEPENDENCY_CATALOG)
    .filter(([, entry]) => entry.kind === "package")
    .map(([name]) => name);

export const MANAGED_PACKAGES = [...MANIFEST_DEPENDENCIES, ...PACKAGE_ONLY_DEPENDENCIES];

export function isManifestDependency(name: string): boolean {
    return MANIFEST_DEPENDENCIES.includes(name);
}

export function isPackageOnlyDependency(name: string): boolean {
    return PACKAGE_ONLY_DEPENDENCIES.includes(name);
}
