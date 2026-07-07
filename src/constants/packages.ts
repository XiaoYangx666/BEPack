export const MANIFEST_DEPENDENCIES = [
    "@minecraft/server",
    "@minecraft/server-ui",
    "@minecraft/server-net",
    "@minecraft/server-admin",
] as const;

export const PACKAGE_ONLY_DEPENDENCIES = ["@minecraft/vanilla-data"] as const;

export const MANAGED_PACKAGES = [...MANIFEST_DEPENDENCIES, ...PACKAGE_ONLY_DEPENDENCIES] as const;

export function isManifestDependency(name: string): boolean {
    return (MANIFEST_DEPENDENCIES as readonly string[]).includes(name);
}

export function isPackageOnlyDependency(name: string): boolean {
    return (PACKAGE_ONLY_DEPENDENCIES as readonly string[]).includes(name);
}
