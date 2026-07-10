import type { DependencyCatalogEntry, ResolvedConfig } from "../config/configTypes.js";
import { BePackError } from "../errors/BePackError.js";
import { BUILTIN_DEPENDENCY_CATALOG } from "../constants/dependencyCatalog.js";
export { BUILTIN_DEPENDENCY_CATALOG };

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
    packageName: string
): DependencyCatalogEntry {
    const entry = catalog[packageName];
    if (!entry) {
        throw new BePackError(
            "UNSUPPORTED_DEPENDENCY",
            `${packageName} is not a managed dependency. Add it to install.dependencyCatalog or remove it from packs.bp.dependencies.`,
            { details: { package: packageName } }
        );
    }
    return entry;
}
