import type {
    DependencyCatalogEntry,
    DependencyKind,
    ResolvedConfig,
} from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";

export const BUILTIN_DEPENDENCY_CATALOG: Record<string, DependencyCatalogEntry> = {
    "@minecraft/server": { kind: "manifest", resolver: "minecraft" },
    "@minecraft/server-ui": { kind: "manifest", resolver: "minecraft" },
    "@minecraft/server-net": { kind: "manifest", resolver: "minecraft" },
    "@minecraft/server-admin": { kind: "manifest", resolver: "minecraft" },
    "@minecraft/vanilla-data": { kind: "package", resolver: "minecraft" },
};

export function createDependencyCatalog(
    config: ResolvedConfig
): Record<string, DependencyCatalogEntry> {
    return {
        ...BUILTIN_DEPENDENCY_CATALOG,
        ...config.install.dependencyCatalog,
    };
}

export function getDependencyCatalogEntry(
    catalog: Record<string, DependencyCatalogEntry>,
    packageName: string,
    expectedKind: DependencyKind
): DependencyCatalogEntry {
    const entry = catalog[packageName];
    if (!entry || entry.kind !== expectedKind) {
        if (expectedKind === "manifest") {
            throw new BePackError(
                "UNSUPPORTED_MANIFEST_DEPENDENCY",
                `${packageName} is not a manifest dependency managed by BePack. Use install.dependencies or package.json instead.`,
                { details: { package: packageName } }
            );
        }
        throw new BePackError(
            "UNSUPPORTED_PACKAGE_DEPENDENCY",
            `${packageName} is not a package-only dependency managed by BePack. Maintain it in package.json instead.`,
            { details: { package: packageName } }
        );
    }
    return entry;
}
