import type {
    ManifestDependency,
    ManifestHeader,
    ManifestResourcesModule as AddonResourcesModule,
    ManifestScriptModule as AddonScriptModule,
    ManifestUnknownModule,
    ManifestVersion,
} from "@bepack/addon/core";

export type { ManifestDependency, ManifestHeader, ManifestUnknownModule, ManifestVersion };

/** BePack-managed BP script module. */
export type ManifestScriptModule = AddonScriptModule & {
    language: "javascript";
    version: ManifestVersion;
    entry: string;
};

/** BePack-managed RP resources module. */
export type ManifestResourcesModule = AddonResourcesModule & {
    version: ManifestVersion;
};

/** User-written or third-party modules keep their original shape. */
export type ManifestModule = ManifestScriptModule | ManifestResourcesModule | ManifestUnknownModule;

/**
 * CLI manifest shape.
 *
 * Header/dependency/version types and the validator live in
 * `@bepack/addon/core`; the CLI only narrows the managed modules to require the
 * fields BePack writes.
 */
export interface Manifest {
    format_version?: number;
    header?: ManifestHeader;
    modules?: ManifestModule[];
    dependencies?: ManifestDependency[];
    capabilities?: string[];
    metadata?: Record<string, unknown>;
    [key: string]: unknown;
}
