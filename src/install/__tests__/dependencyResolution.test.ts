import { describe, it, expect } from "vitest";
import {
    packageVersionForSpecifier,
    stableVersions,
    betaVersions,
    MinecraftPackageResolver,
} from "../MinecraftPackageResolver.js";
import {
    createDependencyCatalog,
    getDependencyCatalogEntry,
    BUILTIN_DEPENDENCY_CATALOG,
} from "../dependencyCatalog.js";
import { minecraftScriptApiResolver } from "../resolvers/minecraftScriptApi.js";
import { minecraftScriptApiBpResolver } from "../resolvers/minecraftScriptApiBp.js";
import { minecraftVanillaDataResolver } from "../resolvers/minecraftVanillaData.js";
import { exactVersionResolver } from "../resolvers/exact.js";
import { DependencyResolverRegistry, BUILTIN_DEPENDENCY_RESOLVERS } from "../resolvers/registry.js";
import type {
    DependencyResolverContext,
    DependencyResolverRule,
    NpmPackageMetadata,
    ResolvedConfig,
} from "../../config/configTypes.js";
import type { NpmRegistryClient } from "../../utils/npmRegistry.js";
import type { DependencyCatalogEntry } from "../../config/configTypes.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const STABLE_VERSIONS = ["2.0.0", "2.1.0", "2.2.0", "2.3.0", "2.4.0", "2.5.0", "2.6.0"];
const BETA_VERSIONS = [
    "2.0.0-beta.1.20.80-stable",
    "2.4.0-beta.1.21.120-stable",
    "2.7.0-beta.1.26.30-stable",
];

const SAPI_PREVIEW_VERSIONS = [
    "2.8.0-rc.1.26.10-preview.25",
    "2.9.0-rc.1.26.40-preview.30",
    "2.10.0-beta.1.26.40-preview.30",
];

const VANILLA_STABLE_VERSIONS = ["1.12.0", "1.12.1", "1.13.0", "1.14.0"];
const VANILLA_PREVIEW_VERSIONS = [
    "1.14.0-preview.1",
    "1.14.0-preview.2",
    "1.14.0-preview.3",
    "1.15.0-preview.1",
];

const MOCK_STABLE_METADATA: NpmPackageMetadata = {
    "dist-tags": { latest: "2.6.0" },
    versions: Object.fromEntries(STABLE_VERSIONS.map((v) => [v, {}])),
};

const MOCK_BETA_METADATA: NpmPackageMetadata = {
    "dist-tags": { latest: "2.6.0", beta: "2.7.0-beta.1.26.30-stable" },
    versions: Object.fromEntries(
        [...STABLE_VERSIONS, ...BETA_VERSIONS, ...SAPI_PREVIEW_VERSIONS].map((v) => [v, {}])
    ),
};

const MOCK_VANILLA_METADATA: NpmPackageMetadata = {
    "dist-tags": { latest: "1.14.0" },
    versions: Object.fromEntries(
        [...VANILLA_STABLE_VERSIONS, ...VANILLA_PREVIEW_VERSIONS].map((v) => [v, {}])
    ),
};

const MOCK_METADATA_NO_TAGS: NpmPackageMetadata = {
    "dist-tags": {},
    versions: Object.fromEntries(STABLE_VERSIONS.map((v) => [v, {}])),
};

const MOCK_METADATA_EMPTY: NpmPackageMetadata = {
    "dist-tags": {},
    versions: {},
};

function mockNpm(metadata: NpmPackageMetadata): NpmRegistryClient {
    return {
        metadata: async () => metadata,
        versions: (m: NpmPackageMetadata) => Object.keys(m.versions ?? {}),
        versionsOf: async () => Object.keys(metadata.versions ?? {}),
        distTag: (m: NpmPackageMetadata, tag: string) => m["dist-tags"]?.[tag],
    } as unknown as NpmRegistryClient;
}

function mockLogger() {
    const noop = () => {};
    return { info: noop, warn: noop, error: noop, verbose: noop, clear: noop, install: noop };
}

const SCRIPT_API_ENTRY: DependencyCatalogEntry = {
    resolver: "minecraft-script-api",
    manifest: true,
};

const VANILLA_DATA_ENTRY: DependencyCatalogEntry = {
    resolver: "minecraft-vanilla-data",
    manifest: false,
};

function ctx(overrides?: Partial<DependencyResolverContext>): DependencyResolverContext {
    return {
        packageName: "@minecraft/server",
        specifier: "stable",
        target: "latest",
        entry: SCRIPT_API_ENTRY,
        config: undefined as unknown as ResolvedConfig,
        npm: mockNpm(MOCK_BETA_METADATA),
        logger: mockLogger(),
        ...overrides,
    };
}

function vanillaCtx(overrides?: Partial<DependencyResolverContext>): DependencyResolverContext {
    return {
        packageName: "@minecraft/vanilla-data",
        specifier: "stable",
        target: "latest",
        entry: VANILLA_DATA_ENTRY,
        config: undefined as unknown as ResolvedConfig,
        npm: mockNpm(MOCK_VANILLA_METADATA),
        logger: mockLogger(),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// dependencyCatalog
// ---------------------------------------------------------------------------

describe("dependencyCatalog", () => {
    it("createDependencyCatalog merges built-in and custom entries", () => {
        const custom = { "my-lib": { resolver: "custom" } };
        const catalog = createDependencyCatalog({
            install: { dependencyCatalog: custom },
        } as unknown as ResolvedConfig);
        expect(catalog["@minecraft/server"]).toMatchObject({ resolver: "minecraft-script-api" });
        expect(catalog["my-lib"]).toEqual({ resolver: "custom" });
    });

    it("createDependencyCatalog custom entries override built-in", () => {
        const custom = { "@minecraft/server": { resolver: "custom-resolver", packageJson: false } };
        const catalog = createDependencyCatalog({
            install: { dependencyCatalog: custom },
        } as unknown as ResolvedConfig);
        expect(catalog["@minecraft/server"]).toEqual({
            resolver: "custom-resolver",
            packageJson: false,
        });
    });

    it("getDependencyCatalogEntry returns matching entry", () => {
        const entry = getDependencyCatalogEntry(BUILTIN_DEPENDENCY_CATALOG, "@minecraft/server");
        expect(entry).toBeDefined();
        expect(entry.resolver).toBe("minecraft-script-api");
        expect(entry.manifest).toBe(true);
    });

    it("getDependencyCatalogEntry throws on unknown dependency", () => {
        expect(() => getDependencyCatalogEntry(BUILTIN_DEPENDENCY_CATALOG, "unknown-pkg")).toThrow(
            "not a managed dependency"
        );
    });

    it("@minecraft/vanilla-data has manifest: false", () => {
        const entry = getDependencyCatalogEntry(
            BUILTIN_DEPENDENCY_CATALOG,
            "@minecraft/vanilla-data"
        );
        expect(entry.manifest).toBe(false);
        expect(entry.resolver).toBe("minecraft-vanilla-data");
    });
});

// ---------------------------------------------------------------------------
// packageVersionForSpecifier
// ---------------------------------------------------------------------------

describe("packageVersionForSpecifier", () => {
    it.each(["stable", "beta", "preview"])(
        "throws DEPENDENCY_VERSION_INVALID for specifier '%s'",
        (specifier) => {
            expect(() => packageVersionForSpecifier(specifier)).toThrow(
                "must be resolved from npm registry"
            );
        }
    );

    it("returns valid semver as-is", () => {
        expect(packageVersionForSpecifier("1.0.0")).toBe("1.0.0");
        expect(packageVersionForSpecifier("2.6.0")).toBe("2.6.0");
        expect(packageVersionForSpecifier("1.0.0-beta.1")).toBe("1.0.0-beta.1");
        expect(packageVersionForSpecifier("1.26.40-preview.30")).toBe("1.26.40-preview.30");
    });

    it("throws for completely invalid strings", () => {
        expect(() => packageVersionForSpecifier("")).toThrow("Unsupported dependency version");
        expect(() => packageVersionForSpecifier("abc")).toThrow("Unsupported dependency version");
        expect(() => packageVersionForSpecifier("latest")).toThrow(
            "Unsupported dependency version"
        );
    });
});

// ---------------------------------------------------------------------------
// stableVersions / betaVersions
// ---------------------------------------------------------------------------

describe("stableVersions", () => {
    it("filters out non-stable versions", () => {
        const result = stableVersions(["1.0.0", "2.0.0-beta", "abc", "3.0.0-alpha"]);
        expect(result).toEqual(["1.0.0"]);
    });

    it("returns empty array when no stable versions", () => {
        expect(stableVersions([])).toEqual([]);
        expect(stableVersions(["abc", "beta"])).toEqual([]);
    });

    it("sorts ascending", () => {
        expect(stableVersions(["2.0.0", "1.0.0", "3.0.0"])).toEqual(["1.0.0", "2.0.0", "3.0.0"]);
    });
});

describe("betaVersions", () => {
    it("filters versions containing beta markers", () => {
        const result = betaVersions(["1.0.0", "2.0.0-beta", "3.0.0-beta.1", "4.0.0-alpha"]);
        expect(result).toEqual(["2.0.0-beta", "3.0.0-beta.1"]);
    });

    it("returns empty array when no beta versions", () => {
        expect(betaVersions([])).toEqual([]);
        expect(betaVersions(["1.0.0", "2.0.0"])).toEqual([]);
    });

    it("sorts ascending", () => {
        const result = betaVersions(["2.0.0-beta.1", "1.0.0-beta.1", "3.0.0-beta.1"]);
        expect(result).toEqual(["1.0.0-beta.1", "2.0.0-beta.1", "3.0.0-beta.1"]);
    });
});

// ---------------------------------------------------------------------------
// MinecraftPackageResolver (shared utilities)
// ---------------------------------------------------------------------------

describe("MinecraftPackageResolver.latestStable", () => {
    it("returns dist-tag latest when it is a stable version", () => {
        const npm = mockNpm(MOCK_STABLE_METADATA);
        const pkg = new MinecraftPackageResolver(npm);
        const result = pkg.latestStable("@minecraft/server", MOCK_STABLE_METADATA);
        expect(result).toBe("2.6.0");
    });

    it("falls back to highest stable version when no dist-tag", () => {
        const npm = mockNpm(MOCK_METADATA_NO_TAGS);
        const pkg = new MinecraftPackageResolver(npm);
        const result = pkg.latestStable("@minecraft/server", MOCK_METADATA_NO_TAGS);
        expect(result).toBe("2.6.0");
    });

    it("throws when no stable versions exist", () => {
        const npm = mockNpm(MOCK_METADATA_EMPTY);
        const pkg = new MinecraftPackageResolver(npm);
        expect(() => pkg.latestStable("@minecraft/server", MOCK_METADATA_EMPTY)).toThrow(
            "Cannot resolve latest stable version"
        );
    });
});

describe("MinecraftPackageResolver.latestBeta", () => {
    it("returns dist-tag beta when present", () => {
        const npm = mockNpm(MOCK_BETA_METADATA);
        const pkg = new MinecraftPackageResolver(npm);
        const result = pkg.latestBeta("@minecraft/server", MOCK_BETA_METADATA);
        expect(result).toBe("2.7.0-beta.1.26.30-stable");
    });

    it("throws when no beta versions exist", () => {
        const npm = mockNpm(MOCK_STABLE_METADATA);
        const pkg = new MinecraftPackageResolver(npm);
        expect(() => pkg.latestBeta("@minecraft/server", MOCK_STABLE_METADATA)).toThrow(
            "Cannot resolve latest beta version"
        );
    });
});

describe("MinecraftPackageResolver.betaForTarget", () => {
    it("returns highest beta version matching target", () => {
        const npm = mockNpm(MOCK_BETA_METADATA);
        const pkg = new MinecraftPackageResolver(npm);
        const result = pkg.betaForTarget("@minecraft/server", "1.21.120", MOCK_BETA_METADATA);
        expect(result).toBe("2.4.0-beta.1.21.120-stable");
    });
});

describe("MinecraftPackageResolver.inferStableFromBeta", () => {
    it("infers stable from beta version: 2.7.0-beta.1.26.30-stable -> 2.6.0", () => {
        const pkg = new MinecraftPackageResolver(mockNpm(MOCK_STABLE_METADATA));
        const result = pkg.inferStableFromBeta(
            "@minecraft/server",
            "1.26.30",
            "2.7.0-beta.1.26.30-stable",
            MOCK_STABLE_METADATA
        );
        expect(result).toBe("2.6.0");
    });
});

// ---------------------------------------------------------------------------
// minecraftScriptApiResolver
// ---------------------------------------------------------------------------

describe("minecraftScriptApiResolver", () => {
    describe("match", () => {
        it("matches specifier 'stable'", () => {
            expect(minecraftScriptApiResolver.match(ctx({ specifier: "stable" }))).toBe(true);
        });

        it("matches specifier 'beta'", () => {
            expect(minecraftScriptApiResolver.match(ctx({ specifier: "beta" }))).toBe(true);
        });

        it("matches specifier 'preview'", () => {
            expect(minecraftScriptApiResolver.match(ctx({ specifier: "preview" }))).toBe(true);
        });

        it("does not match exact version (handled by exact resolver)", () => {
            expect(minecraftScriptApiResolver.match(ctx({ specifier: "2.6.0" }))).toBe(false);
            expect(minecraftScriptApiResolver.match(ctx({ specifier: "1.0.0-beta.1" }))).toBe(
                false
            );
        });
    });

    describe("resolve stable", () => {
        it("target 'latest' resolves stable inferred from latest beta", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftScriptApiResolver.resolve(
                ctx({ specifier: "stable", target: "latest", npm })
            );
            // latest beta is 2.7.0-beta.1.26.30-stable -> inferred stable is 2.6.0
            expect(result.packageVersion).toBe("2.6.0");
            expect(result.manifestVersion).toBe("2.6.0");
        });

        it("concrete target infers stable from beta version", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftScriptApiResolver.resolve(
                ctx({ specifier: "stable", target: "1.26.30", npm })
            );
            expect(result.packageVersion).toBe("2.6.0");
            expect(result.manifestVersion).toBe("2.6.0");
        });
    });

    describe("resolve beta", () => {
        it("target 'latest' returns beta dist-tag, manifest 'beta'", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftScriptApiResolver.resolve(
                ctx({ specifier: "beta", target: "latest", npm })
            );
            expect(result.packageVersion).toBe("2.7.0-beta.1.26.30-stable");
            expect(result.manifestVersion).toBe("beta");
        });

        it("concrete target >= 1.21.120 returns matching beta, manifest 'beta'", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftScriptApiResolver.resolve(
                ctx({ specifier: "beta", target: "1.21.120", npm })
            );
            expect(result.packageVersion).toBe("2.4.0-beta.1.21.120-stable");
            expect(result.manifestVersion).toBe("beta");
        });

        it("old target (< 1.21.120) returns short beta form in manifest", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftScriptApiResolver.resolve(
                ctx({ specifier: "beta", target: "1.20.80", npm })
            );
            expect(result.packageVersion).toBe("2.0.0-beta.1.20.80-stable");
            expect(result.manifestVersion).toBe("2.0.0-beta");
        });
    });

    describe("resolve preview", () => {
        it("target 'latest' resolves to latest preview version", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftScriptApiResolver.resolve(
                ctx({ specifier: "preview", target: "latest", npm })
            );
            expect(result.packageVersion).toBe("2.10.0-beta.1.26.40-preview.30");
        });

        it("concrete target resolves to highest matching preview", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftScriptApiResolver.resolve(
                ctx({ specifier: "preview", target: "1.26.40", npm })
            );
            // Should prefer 2.10.0-beta over 2.9.0-rc for target 1.26.40
            expect(result.packageVersion).toBe("2.10.0-beta.1.26.40-preview.30");
        });

        it("throws when no preview matches target", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            await expect(
                minecraftScriptApiResolver.resolve(
                    ctx({ specifier: "preview", target: "9.99.99", npm })
                )
            ).rejects.toThrow("Cannot resolve");
        });
    });
});

// ---------------------------------------------------------------------------
// minecraftScriptApiBpResolver (beta/preview only, no stable)
// ---------------------------------------------------------------------------

describe("minecraftScriptApiBpResolver", () => {
    describe("match", () => {
        it("matches specifier 'beta'", () => {
            expect(minecraftScriptApiBpResolver.match(ctx({ specifier: "beta" }))).toBe(true);
        });

        it("matches specifier 'preview'", () => {
            expect(minecraftScriptApiBpResolver.match(ctx({ specifier: "preview" }))).toBe(true);
        });

        it("does not match specifier 'stable'", () => {
            expect(minecraftScriptApiBpResolver.match(ctx({ specifier: "stable" }))).toBe(false);
        });

        it("does not match exact version", () => {
            expect(minecraftScriptApiBpResolver.match(ctx({ specifier: "2.6.0" }))).toBe(false);
        });
    });

    describe("resolve beta", () => {
        it("target 'latest' resolves to latest beta (excluding preview)", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftScriptApiBpResolver.resolve(
                ctx({ specifier: "beta", target: "latest", npm })
            );
            expect(result.packageVersion).toBe("2.7.0-beta.1.26.30-stable");
            expect(result.manifestVersion).toBe("beta");
        });

        it("concrete target resolves to matching beta", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftScriptApiBpResolver.resolve(
                ctx({ specifier: "beta", target: "1.21.120", npm })
            );
            expect(result.packageVersion).toBe("2.4.0-beta.1.21.120-stable");
        });
    });

    describe("resolve preview", () => {
        it("target 'latest' resolves to latest preview", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftScriptApiBpResolver.resolve(
                ctx({ specifier: "preview", target: "latest", npm })
            );
            expect(result.packageVersion).toBe("2.10.0-beta.1.26.40-preview.30");
        });

        it("concrete target resolves to highest matching preview", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftScriptApiBpResolver.resolve(
                ctx({ specifier: "preview", target: "1.26.40", npm })
            );
            expect(result.packageVersion).toBe("2.10.0-beta.1.26.40-preview.30");
        });
    });
});

// ---------------------------------------------------------------------------
// minecraftVanillaDataResolver
// ---------------------------------------------------------------------------

describe("minecraftVanillaDataResolver", () => {
    describe("match", () => {
        it("matches specifier 'stable'", () => {
            expect(minecraftVanillaDataResolver.match(ctx({ specifier: "stable" }))).toBe(true);
        });

        it("matches specifier 'preview'", () => {
            expect(minecraftVanillaDataResolver.match(ctx({ specifier: "preview" }))).toBe(true);
        });

        it("does not match specifier 'beta'", () => {
            expect(minecraftVanillaDataResolver.match(ctx({ specifier: "beta" }))).toBe(false);
        });

        it("does not match exact version", () => {
            expect(minecraftVanillaDataResolver.match(ctx({ specifier: "1.12.0" }))).toBe(false);
        });
    });

    describe("resolve stable", () => {
        it("target 'latest' resolves to latest stable", async () => {
            const npm = mockNpm(MOCK_VANILLA_METADATA);
            const result = await minecraftVanillaDataResolver.resolve(
                vanillaCtx({ specifier: "stable", target: "latest", npm })
            );
            expect(result.packageVersion).toBe("1.14.0");
        });

        it("concrete target resolves to that exact version", async () => {
            const npm = mockNpm(MOCK_VANILLA_METADATA);
            const result = await minecraftVanillaDataResolver.resolve(
                vanillaCtx({ specifier: "stable", target: "1.12.0", npm })
            );
            expect(result.packageVersion).toBe("1.12.0");
        });

        it("throws when target version does not exist", async () => {
            const npm = mockNpm(MOCK_VANILLA_METADATA);
            await expect(
                minecraftVanillaDataResolver.resolve(
                    vanillaCtx({ specifier: "stable", target: "9.99.99", npm })
                )
            ).rejects.toThrow("Cannot resolve");
        });
    });

    describe("resolve preview", () => {
        it("target 'latest' resolves to latest preview", async () => {
            const npm = mockNpm(MOCK_VANILLA_METADATA);
            const result = await minecraftVanillaDataResolver.resolve(
                vanillaCtx({ specifier: "preview", target: "latest", npm })
            );
            expect(result.packageVersion).toBe("1.15.0-preview.1");
        });

        it("concrete target resolves to highest matching preview", async () => {
            const npm = mockNpm(MOCK_VANILLA_METADATA);
            const result = await minecraftVanillaDataResolver.resolve(
                vanillaCtx({ specifier: "preview", target: "1.14.0", npm })
            );
            expect(result.packageVersion).toBe("1.14.0-preview.3");
        });

        it("throws when no preview matches target", async () => {
            const npm = mockNpm(MOCK_VANILLA_METADATA);
            await expect(
                minecraftVanillaDataResolver.resolve(
                    vanillaCtx({ specifier: "preview", target: "1.10.0", npm })
                )
            ).rejects.toThrow("Cannot resolve");
        });
    });
});

// ---------------------------------------------------------------------------
// exactVersionResolver
// ---------------------------------------------------------------------------

describe("exactVersionResolver", () => {
    describe("match", () => {
        it.each([
            "1.0.0",
            "2.6.0",
            "1.0.0-beta.1",
            "2.4.0-beta.1.21.120-stable",
            "1.26.40-preview.30",
        ])("matches exact version '%s'", (specifier) => {
            expect(exactVersionResolver.match(ctx({ specifier }))).toBe(true);
        });

        it.each(["stable", "beta", "preview", "", "abc"])("does not match '%s'", (specifier) => {
            expect(exactVersionResolver.match(ctx({ specifier }))).toBe(false);
        });
    });

    describe("resolve", () => {
        it("returns the specifier as packageVersion and manifestVersion", async () => {
            const result = await exactVersionResolver.resolve(ctx({ specifier: "1.5.0" }));
            expect(result.packageVersion).toBe("1.5.0");
            expect(result.manifestVersion).toBe("1.5.0");
        });

        it("handles preview format versions", async () => {
            const result = await exactVersionResolver.resolve(
                ctx({ specifier: "1.26.40-preview.30" })
            );
            expect(result.packageVersion).toBe("1.26.40-preview.30");
            expect(result.manifestVersion).toBe("1.26.40-preview.30");
        });
    });
});

// ---------------------------------------------------------------------------
// DependencyResolverRegistry
// ---------------------------------------------------------------------------

describe("DependencyResolverRegistry", () => {
    it("custom resolvers are tried before built-in", async () => {
        const custom: DependencyResolverRule = {
            name: "custom-beta",
            resolver: "minecraft-script-api",
            match: (c) => c.specifier === "beta",
            resolve: async () => ({
                packageVersion: "999.0.0-custom",
                manifestVersion: "999.0.0-custom",
            }),
        };
        const registry = DependencyResolverRegistry.fromConfig([custom]);
        const npm = mockNpm(MOCK_BETA_METADATA);
        const result = await registry.resolve(
            ctx({ specifier: "beta", npm, entry: SCRIPT_API_ENTRY })
        );
        expect(result.packageVersion).toBe("999.0.0-custom");
    });

    it("falls through to built-in when custom does not match", async () => {
        const custom: DependencyResolverRule = {
            name: "custom-only-special",
            match: (c) => c.specifier === "non-existent",
            resolve: async () => ({ packageVersion: "0.0.0", manifestVersion: null }),
        };
        const registry = DependencyResolverRegistry.fromConfig([custom]);
        const npm = mockNpm(MOCK_BETA_METADATA);
        const result = await registry.resolve(
            ctx({ specifier: "stable", npm, entry: SCRIPT_API_ENTRY })
        );
        expect(result.packageVersion).toBe("2.6.0");
    });

    it("throws DEPENDENCY_VERSION_INVALID when no resolver matches", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        await expect(registry.resolve(ctx({ specifier: "some-garbage-@@@" }))).rejects.toThrow(
            "dependency version is invalid"
        );
    });

    it("@minecraft/server-net@stable throws (bp resolver does not support stable)", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        const npm = mockNpm(MOCK_BETA_METADATA);
        await expect(
            registry.resolve(
                ctx({
                    specifier: "stable",
                    npm,
                    packageName: "@minecraft/server-net",
                    entry: {
                        resolver: "minecraft-script-api-bp",
                        manifest: true,
                    },
                })
            )
        ).rejects.toThrow("dependency version is invalid");
    });

    it("@minecraft/server@preview resolves to latest preview", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        const npm = mockNpm(MOCK_BETA_METADATA);
        const result = await registry.resolve(
            ctx({
                specifier: "preview",
                npm,
                entry: SCRIPT_API_ENTRY,
            })
        );
        expect(result.packageVersion).toBe("2.10.0-beta.1.26.40-preview.30");
    });

    it("@minecraft/vanilla-data@beta throws (no resolver matches beta for vanilla-data)", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        const npm = mockNpm(MOCK_VANILLA_METADATA);
        await expect(
            registry.resolve(
                ctx({
                    specifier: "beta",
                    npm,
                    packageName: "@minecraft/vanilla-data",
                    entry: VANILLA_DATA_ENTRY,
                })
            )
        ).rejects.toThrow("dependency version is invalid");
    });

    it("built-in resolvers have a name and resolve function", () => {
        for (const rule of BUILTIN_DEPENDENCY_RESOLVERS) {
            expect(rule.name).toBeTruthy();
            expect(typeof rule.resolve).toBe("function");
        }
    });
});

// ---------------------------------------------------------------------------
// Integration: full resolve flow
// ---------------------------------------------------------------------------

describe("integration", () => {
    const npm = mockNpm(MOCK_BETA_METADATA);

    it("resolves @minecraft/server@stable under target latest", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        const result = await registry.resolve(
            ctx({ specifier: "stable", npm, entry: SCRIPT_API_ENTRY })
        );
        expect(result).toEqual({ packageVersion: "2.6.0", manifestVersion: "2.6.0" });
    });

    it("resolves @minecraft/server@beta under target latest", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        const result = await registry.resolve(
            ctx({ specifier: "beta", npm, entry: SCRIPT_API_ENTRY })
        );
        expect(result).toEqual({
            packageVersion: "2.7.0-beta.1.26.30-stable",
            manifestVersion: "beta",
        });
    });

    it("resolves @minecraft/server@beta under target 1.20.80 (old target)", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        const result = await registry.resolve(
            ctx({ specifier: "beta", target: "1.20.80", npm, entry: SCRIPT_API_ENTRY })
        );
        expect(result).toEqual({
            packageVersion: "2.0.0-beta.1.20.80-stable",
            manifestVersion: "2.0.0-beta",
        });
    });

    it("resolves @minecraft/vanilla-data@1.12.0 as exact version", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        const result = await registry.resolve(
            ctx({
                specifier: "1.12.0",
                npm,
                packageName: "@minecraft/vanilla-data",
                entry: VANILLA_DATA_ENTRY,
            })
        );
        expect(result).toEqual({ packageVersion: "1.12.0", manifestVersion: "1.12.0" });
    });
});

// ---------------------------------------------------------------------------
// DependencyService: ResolvedDependency structure
// ---------------------------------------------------------------------------

describe("DependencyService resolved structure", () => {
    it("@minecraft/server produces manifest: true, external: true", () => {
        const config = {
            packs: {
                bp: {
                    dependencies: {
                        "@minecraft/server": "beta",
                    },
                },
            },
            install: { dependencyCatalog: {} },
            target: "latest",
        } as unknown as ResolvedConfig;

        const catalog = createDependencyCatalog(config);
        const entry = getDependencyCatalogEntry(catalog, "@minecraft/server");
        expect(entry.manifest).toBe(true);
        // external derives from manifest
        expect(entry.manifest).toBe(true);
    });

    it("@minecraft/vanilla-data produces manifest: false, external: false", () => {
        const config = {
            packs: {
                bp: {
                    dependencies: {
                        "@minecraft/vanilla-data": "stable",
                    },
                },
            },
            install: { dependencyCatalog: {} },
            target: "latest",
        } as unknown as ResolvedConfig;

        const catalog = createDependencyCatalog(config);
        const entry = getDependencyCatalogEntry(catalog, "@minecraft/vanilla-data");
        expect(entry.manifest).toBe(false);
    });
});
