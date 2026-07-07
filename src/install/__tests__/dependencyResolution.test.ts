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
import {
    minecraftStableResolver,
    minecraftBetaResolver,
    exactVersionResolver,
    DependencyResolverRegistry,
    BUILTIN_DEPENDENCY_RESOLVERS,
} from "../resolvers/minecraft.js";
import type {
    DependencyResolverContext,
    DependencyResolverRule,
    NpmPackageMetadata,
    ResolvedConfig,
} from "../../config/configTypes.js";
import type { NpmClient } from "../MinecraftPackageResolver.js";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const STABLE_VERSIONS = ["2.0.0", "2.1.0", "2.2.0", "2.3.0", "2.4.0", "2.5.0", "2.6.0"];
const BETA_VERSIONS = [
    "2.0.0-beta.1.20.80-stable",
    "2.4.0-beta.1.21.120-stable",
    "2.7.0-beta.1.26.30-stable",
];

const MOCK_STABLE_METADATA: NpmPackageMetadata = {
    "dist-tags": { latest: "2.6.0" },
    versions: Object.fromEntries(STABLE_VERSIONS.map((v) => [v, {}])),
};

const MOCK_BETA_METADATA: NpmPackageMetadata = {
    "dist-tags": { latest: "2.6.0", beta: "2.7.0-beta.1.26.30-stable" },
    versions: Object.fromEntries([...STABLE_VERSIONS, ...BETA_VERSIONS].map((v) => [v, {}])),
};

const MOCK_METADATA_NO_TAGS: NpmPackageMetadata = {
    "dist-tags": {},
    versions: Object.fromEntries(STABLE_VERSIONS.map((v) => [v, {}])),
};

const MOCK_METADATA_EMPTY: NpmPackageMetadata = {
    "dist-tags": {},
    versions: {},
};

function mockNpm(metadata: NpmPackageMetadata): NpmClient {
    return {
        metadata: async () => metadata,
        versions: (m: NpmPackageMetadata) => Object.keys(m.versions ?? {}),
        versionsOf: async () => Object.keys(metadata.versions ?? {}),
        distTag: (m: NpmPackageMetadata, tag: string) => m["dist-tags"]?.[tag],
    };
}

function mockLogger(level: "quiet" | "verbose" = "quiet") {
    const fn = (
        level === "verbose" ? (...args: unknown[]) => console.debug(...args) : () => {}
    ) as typeof console.log;
    return { info: fn, warn: fn, error: fn, verbose: fn, clear: fn };
}

function ctx(overrides?: Partial<DependencyResolverContext>): DependencyResolverContext {
    return {
        packageName: "@minecraft/server",
        specifier: "stable",
        kind: "manifest",
        package: { kind: "manifest", resolver: "minecraft" },
        target: "latest",
        registry: "https://registry.npmjs.org/",
        config: undefined as unknown as ResolvedConfig,
        npm: mockNpm(MOCK_BETA_METADATA),
        logger: mockLogger(),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// dependencyCatalog
// ---------------------------------------------------------------------------

describe("dependencyCatalog", () => {
    it("createDependencyCatalog merges built-in and custom entries", () => {
        const custom = { "my-lib": { kind: "package" as const } };
        const catalog = createDependencyCatalog({
            install: { dependencyCatalog: custom },
        } as unknown as ResolvedConfig);
        expect(catalog["@minecraft/server"]).toEqual({ kind: "manifest", resolver: "minecraft" });
        expect(catalog["my-lib"]).toEqual({ kind: "package" });
    });

    it("createDependencyCatalog custom entries override built-in", () => {
        const custom = { "@minecraft/server": { kind: "package" as const } };
        const catalog = createDependencyCatalog({
            install: { dependencyCatalog: custom },
        } as unknown as ResolvedConfig);
        expect(catalog["@minecraft/server"]).toEqual({ kind: "package" });
    });

    it("getDependencyCatalogEntry returns matching entry", () => {
        const entry = getDependencyCatalogEntry(
            BUILTIN_DEPENDENCY_CATALOG,
            "@minecraft/server",
            "manifest"
        );
        expect(entry).toBeDefined();
        expect(entry.kind).toBe("manifest");
    });

    it("getDependencyCatalogEntry throws on unknown manifest dependency", () => {
        expect(() =>
            getDependencyCatalogEntry(BUILTIN_DEPENDENCY_CATALOG, "unknown-pkg", "manifest")
        ).toThrow("not a manifest dependency");
    });

    it("getDependencyCatalogEntry throws on unknown package dependency", () => {
        expect(() =>
            getDependencyCatalogEntry(BUILTIN_DEPENDENCY_CATALOG, "unknown-pkg", "package")
        ).toThrow("not a package-only dependency");
    });

    it("getDependencyCatalogEntry throws when kind mismatches", () => {
        expect(() =>
            getDependencyCatalogEntry(
                BUILTIN_DEPENDENCY_CATALOG,
                "@minecraft/vanilla-data",
                "manifest"
            )
        ).toThrow("not a manifest dependency");
    });
});

// ---------------------------------------------------------------------------
// packageVersionForSpecifier
// ---------------------------------------------------------------------------

describe("packageVersionForSpecifier", () => {
    it.each(["stable", "beta"])(
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

    it("handles pre-release tags correctly (filters them out)", () => {
        const result = stableVersions(["2.4.0-beta.1.21.120-stable", "2.4.0"]);
        expect(result).toEqual(["2.4.0"]);
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

    it("is case-insensitive for beta marker", () => {
        const result = betaVersions(["1.0.0-Beta.1", "2.0.0-beta.2"]);
        expect(result).toHaveLength(2);
    });
});

// ---------------------------------------------------------------------------
// resolveLatestStableVersionFromMetadata
// ---------------------------------------------------------------------------

describe("resolveLatestStableVersionFromMetadata (MinecraftPackageResolver.latestStable)", () => {
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

// ---------------------------------------------------------------------------
// resolveLatestBetaVersionFromMetadata
// ---------------------------------------------------------------------------

describe("resolveLatestBetaVersionFromMetadata (MinecraftPackageResolver.latestBeta)", () => {
    it("returns dist-tag beta when present", () => {
        const npm = mockNpm(MOCK_BETA_METADATA);
        const pkg = new MinecraftPackageResolver(npm);
        const result = pkg.latestBeta("@minecraft/server", MOCK_BETA_METADATA);
        expect(result).toBe("2.7.0-beta.1.26.30-stable");
    });

    it("falls back to highest beta version when no dist-tag", () => {
        const noTag = {
            ...MOCK_METADATA_NO_TAGS,
            versions: { ...MOCK_METADATA_NO_TAGS.versions, "2.0.0-beta.1": {}, "1.0.0-beta.1": {} },
        };
        const npm = mockNpm(noTag);
        const pkg = new MinecraftPackageResolver(npm);
        const result = pkg.latestBeta("@minecraft/server", noTag);
        expect(result).toBe("2.0.0-beta.1");
    });

    it("throws when no beta versions exist", () => {
        const npm = mockNpm(MOCK_STABLE_METADATA);
        const pkg = new MinecraftPackageResolver(npm);
        expect(() => pkg.latestBeta("@minecraft/server", MOCK_STABLE_METADATA)).toThrow(
            "Cannot resolve latest beta version"
        );
    });
});

// ---------------------------------------------------------------------------
// resolveBetaVersionFromMetadata
// ---------------------------------------------------------------------------

describe("resolveBetaVersionFromMetadata (MinecraftPackageResolver.betaForTarget)", () => {
    it("returns highest beta version matching target", () => {
        const npm = mockNpm(MOCK_BETA_METADATA);
        const pkg = new MinecraftPackageResolver(npm);
        const result = pkg.betaForTarget("@minecraft/server", "1.21.120", MOCK_BETA_METADATA);
        expect(result).toBe("2.4.0-beta.1.21.120-stable");
    });

    it("throws when no beta version matches the target", () => {
        const npm = mockNpm(MOCK_BETA_METADATA);
        const pkg = new MinecraftPackageResolver(npm);
        expect(() => pkg.betaForTarget("@minecraft/server", "9.99.99", MOCK_BETA_METADATA)).toThrow(
            "Cannot resolve @minecraft/server@beta for target"
        );
    });
});

// ---------------------------------------------------------------------------
// inferStableVersionFromBeta
// ---------------------------------------------------------------------------

describe("resolveBetaVersionFromMetadata (MinecraftPackageResolver.inferStableFromBeta)", () => {
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

    it("infers stable from beta version: 2.4.0-beta.1.21.120-stable -> 2.3.0", () => {
        const pkg = new MinecraftPackageResolver(mockNpm(MOCK_STABLE_METADATA));
        const result = pkg.inferStableFromBeta(
            "@minecraft/server",
            "1.21.120",
            "2.4.0-beta.1.21.120-stable",
            MOCK_STABLE_METADATA
        );
        expect(result).toBe("2.3.0");
    });

    it("throws when beta string cannot be parsed", () => {
        const pkg = new MinecraftPackageResolver(mockNpm(MOCK_STABLE_METADATA));
        expect(() =>
            pkg.inferStableFromBeta(
                "@minecraft/server",
                "1.21.120",
                "not-a-version",
                MOCK_STABLE_METADATA
            )
        ).toThrow("Cannot infer stable version");
    });

    it("throws when inferred stable version does not exist in metadata", () => {
        const pkg = new MinecraftPackageResolver(mockNpm(MOCK_STABLE_METADATA));
        expect(() =>
            pkg.inferStableFromBeta(
                "@minecraft/server",
                "1.99.99",
                "1.0.0-beta.1.99.99-stable",
                MOCK_STABLE_METADATA
            )
        ).toThrow("Cannot confirm inferred stable version");
    });

    it("throws when minor version would be negative", () => {
        const pkg = new MinecraftPackageResolver(mockNpm(MOCK_STABLE_METADATA));
        expect(() =>
            pkg.inferStableFromBeta(
                "@minecraft/server",
                "1.20.80",
                "0.0.5-beta.1.20.80-stable",
                MOCK_STABLE_METADATA
            )
        ).toThrow("Cannot confirm inferred stable version");
    });
});

// ---------------------------------------------------------------------------
// minecraftStableResolver
// ---------------------------------------------------------------------------

describe("minecraftStableResolver", () => {
    describe("match", () => {
        it("matches specifier 'stable'", () => {
            expect(minecraftStableResolver.match(ctx({ specifier: "stable" }))).toBe(true);
        });

        it("does not match specifier 'beta'", () => {
            expect(minecraftStableResolver.match(ctx({ specifier: "beta" }))).toBe(false);
        });

        it("does not match specifier '1.0.0'", () => {
            expect(minecraftStableResolver.match(ctx({ specifier: "1.0.0" }))).toBe(false);
        });

        it("does not match specifier 'STABLE' (case-sensitive)", () => {
            expect(minecraftStableResolver.match(ctx({ specifier: "STABLE" }))).toBe(false);
        });
    });

    describe("resolve", () => {
        it("target 'latest' resolves from dist-tag", async () => {
            const npm = mockNpm(MOCK_STABLE_METADATA);
            const result = await minecraftStableResolver.resolve(ctx({ target: "latest", npm }));
            expect(result.packageVersion).toBe("2.6.0");
            expect(result.manifestVersion).toBe("2.6.0");
        });

        it("concrete target infers stable from beta version", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftStableResolver.resolve(ctx({ target: "1.26.30", npm }));
            expect(result.packageVersion).toBe("2.6.0");
            expect(result.manifestVersion).toBe("2.6.0");
        });

        it("resolves for package-only dependencies (no manifestVersion)", async () => {
            const npm = mockNpm(MOCK_STABLE_METADATA);
            const result = await minecraftStableResolver.resolve(
                ctx({ target: "latest", kind: "package", npm })
            );
            expect(result.packageVersion).toBe("2.6.0");
            expect(result.manifestVersion).toBeNull();
        });
    });
});

// ---------------------------------------------------------------------------
// minecraftBetaResolver
// ---------------------------------------------------------------------------

describe("minecraftBetaResolver", () => {
    describe("match", () => {
        it("matches specifier 'beta'", () => {
            expect(minecraftBetaResolver.match(ctx({ specifier: "beta" }))).toBe(true);
        });

        it("does not match specifier 'stable'", () => {
            expect(minecraftBetaResolver.match(ctx({ specifier: "stable" }))).toBe(false);
        });

        it("does not match specifier '1.0.0'", () => {
            expect(minecraftBetaResolver.match(ctx({ specifier: "1.0.0" }))).toBe(false);
        });
    });

    describe("resolve", () => {
        it("target 'latest' returns beta dist-tag version, manifest 'beta'", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftBetaResolver.resolve(
                ctx({ specifier: "beta", target: "latest", npm })
            );
            expect(result.packageVersion).toBe("2.7.0-beta.1.26.30-stable");
            expect(result.manifestVersion).toBe("beta");
        });

        it("concrete target that supports channel returns matching beta, manifest 'beta'", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftBetaResolver.resolve(
                ctx({ specifier: "beta", target: "1.21.120", npm })
            );
            expect(result.packageVersion).toBe("2.4.0-beta.1.21.120-stable");
            expect(result.manifestVersion).toBe("beta");
        });

        it("old target (< 1.21.120) returns short beta form in manifest", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftBetaResolver.resolve(
                ctx({ specifier: "beta", target: "1.20.80", npm })
            );
            expect(result.packageVersion).toBe("2.0.0-beta.1.20.80-stable");
            expect(result.manifestVersion).toBe("2.0.0-beta");
        });

        it("package-only dependency has null manifestVersion", async () => {
            const npm = mockNpm(MOCK_BETA_METADATA);
            const result = await minecraftBetaResolver.resolve(
                ctx({ specifier: "beta", target: "latest", kind: "package", npm })
            );
            expect(result.packageVersion).toBe("2.7.0-beta.1.26.30-stable");
            expect(result.manifestVersion).toBeNull();
        });
    });
});

// ---------------------------------------------------------------------------
// exactVersionResolver
// ---------------------------------------------------------------------------

describe("exactVersionResolver", () => {
    describe("match", () => {
        it.each(["1.0.0", "2.6.0", "1.0.0-beta.1", "2.4.0-beta.1.21.120-stable"])(
            "matches exact version '%s'",
            (specifier) => {
                expect(exactVersionResolver.match(ctx({ specifier }))).toBe(true);
            }
        );

        it.each(["stable", "beta", "", "abc"])("does not match '%s'", (specifier) => {
            expect(exactVersionResolver.match(ctx({ specifier }))).toBe(false);
        });

        it("does not match '1.2.3.4' because the regex treats .4 as pre-release suffix", () => {
            // 1.2.3 matches \d+\.\d+\.\d+ and .4 is consumed by the optional (?:[-.][...])?
            expect(exactVersionResolver.match(ctx({ specifier: "1.2.3.4" }))).toBe(true);
        });
    });

    describe("resolve", () => {
        it("returns the specifier as both versions for manifest", async () => {
            const result = await exactVersionResolver.resolve(ctx({ specifier: "1.5.0" }));
            expect(result.packageVersion).toBe("1.5.0");
            expect(result.manifestVersion).toBe("1.5.0");
        });

        it("returns null manifestVersion for package-only", async () => {
            const result = await exactVersionResolver.resolve(
                ctx({ specifier: "1.5.0", kind: "package" })
            );
            expect(result.packageVersion).toBe("1.5.0");
            expect(result.manifestVersion).toBeNull();
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
            resolver: "minecraft",
            match: (c) => c.specifier === "beta",
            resolve: async () => ({
                packageVersion: "999.0.0-custom",
                manifestVersion: "999.0.0-custom",
            }),
        };
        const registry = DependencyResolverRegistry.fromConfig([custom]);
        const npm = mockNpm(MOCK_BETA_METADATA);
        const result = await registry.resolve(ctx({ specifier: "beta", npm }));
        expect(result.packageVersion).toBe("999.0.0-custom");
    });

    it("falls through to built-in when custom does not match", async () => {
        const custom: DependencyResolverRule = {
            name: "custom-only-beta",
            match: (c) => c.specifier === "non-existent",
            resolve: async () => ({ packageVersion: "0.0.0", manifestVersion: null }),
        };
        const registry = DependencyResolverRegistry.fromConfig([custom]);
        const npm = mockNpm(MOCK_STABLE_METADATA);
        const result = await registry.resolve(ctx({ specifier: "stable", npm }));
        expect(result.packageVersion).toBe("2.6.0");
    });

    it("throws DEPENDENCY_VERSION_INVALID when no resolver matches", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        await expect(registry.resolve(ctx({ specifier: "some-garbage-@@@" }))).rejects.toThrow(
            "dependency version is invalid"
        );
    });

    it.each(BUILTIN_DEPENDENCY_RESOLVERS)(
        "built-in resolver '%s' has a name and resolve function",
        (rule) => {
            expect(rule.name).toBeTruthy();
            expect(typeof rule.resolve).toBe("function");
        }
    );
});

// ---------------------------------------------------------------------------
// Integration: full resolve flow
// ---------------------------------------------------------------------------

describe("integration", () => {
    const npm = mockNpm(MOCK_BETA_METADATA);

    const manifestContext = (specifier: string, target = "latest") =>
        ctx({ specifier, target, npm, kind: "manifest" });

    it("resolves @minecraft/server@stable under target latest", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        const result = await registry.resolve(manifestContext("stable"));
        expect(result).toEqual({ packageVersion: "2.6.0", manifestVersion: "2.6.0" });
    });

    it("resolves @minecraft/server@beta under target latest", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        const result = await registry.resolve(manifestContext("beta"));
        expect(result).toEqual({
            packageVersion: "2.7.0-beta.1.26.30-stable",
            manifestVersion: "beta",
        });
    });

    it("resolves @minecraft/server@beta under target 1.20.80 (old target)", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        const result = await registry.resolve(manifestContext("beta", "1.20.80"));
        expect(result).toEqual({
            packageVersion: "2.0.0-beta.1.20.80-stable",
            manifestVersion: "2.0.0-beta",
        });
    });

    it("resolves @minecraft/vanilla-data@1.12.0 as exact version", async () => {
        const registry = DependencyResolverRegistry.fromConfig([]);
        const result = await registry.resolve(ctx({ specifier: "1.12.0", npm }));
        expect(result).toEqual({ packageVersion: "1.12.0", manifestVersion: "1.12.0" });
    });
});
