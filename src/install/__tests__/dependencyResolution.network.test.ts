import { describe, it, expect } from "vitest";
import { NpmRegistryClient } from "../../utils/npmRegistry.js";

// Network tests hit the real npm registry; allow up to 15 s per request.
const NET_TIMEOUT = 15000;
import { DependencyResolverRegistry } from "../resolvers/registry.js";
import type { DependencyResolverContext, ResolvedConfig } from "../../config/configTypes.js";
import type { DependencyCatalogEntry } from "../../config/configTypes.js";

const REGISTRY = "https://registry.npmjs.org/";

function liveNpm(): NpmRegistryClient {
    return new NpmRegistryClient(REGISTRY);
}

const SCRIPT_API_ENTRY: DependencyCatalogEntry = {
    resolver: "minecraft-script-api",
    manifest: true,
};

const VANILLA_DATA_ENTRY: DependencyCatalogEntry = {
    resolver: "minecraft-vanilla-data",
    manifest: false,
};

function ctx(
    overrides: Partial<DependencyResolverContext> & { npm: NpmRegistryClient }
): DependencyResolverContext {
    return {
        packageName: "@minecraft/server",
        specifier: "stable",
        target: "latest",
        entry: SCRIPT_API_ENTRY,
        config: {
            target: overrides.target ?? "latest",
            install: { registry: REGISTRY, dependencyResolvers: [] },
        } as unknown as ResolvedConfig,
        ...overrides,
    };
}

function vanillaCtx(
    overrides: Partial<DependencyResolverContext> & { npm: NpmRegistryClient }
): DependencyResolverContext {
    return {
        packageName: "@minecraft/vanilla-data",
        specifier: "stable",
        target: "latest",
        entry: VANILLA_DATA_ENTRY,
        config: {
            target: overrides.target ?? "latest",
            install: { registry: REGISTRY, dependencyResolvers: [] },
        } as unknown as ResolvedConfig,
        ...overrides,
    };
}

describe("integration: real npm registry", () => {
    const npm = liveNpm();

    // -----------------------------------------------------------------------
    // Script API: stable
    // -----------------------------------------------------------------------
    describe("minecraft-script-api stable", () => {
        it(
            'target "latest" resolves to latest dist-tag',
            async () => {
                const registry = DependencyResolverRegistry.fromConfig([]);
                const result = await registry.resolve(
                    ctx({ specifier: "stable", target: "latest", npm })
                );
                console.log(
                    `  stable + latest -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
                );
                expect(result.packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
                expect(result.manifestVersion).toBe(result.packageVersion);
            },
            NET_TIMEOUT
        );

        it(
            "concrete target 1.26.32 infers stable from matching beta",
            async () => {
                const registry = DependencyResolverRegistry.fromConfig([]);
                const result = await registry.resolve(
                    ctx({ specifier: "stable", target: "1.26.32", npm })
                );
                console.log(
                    `  stable + 1.26.32 -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
                );
                expect(result.packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
            },
            NET_TIMEOUT
        );
    });

    // -----------------------------------------------------------------------
    // Script API: beta
    // -----------------------------------------------------------------------
    describe("minecraft-script-api beta", () => {
        it(
            'target "latest" returns beta dist-tag, manifest "beta"',
            async () => {
                const registry = DependencyResolverRegistry.fromConfig([]);
                const result = await registry.resolve(
                    ctx({ specifier: "beta", target: "latest", npm })
                );
                console.log(
                    `  beta + latest -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
                );
                expect(result.manifestVersion).toBe("beta");
            },
            NET_TIMEOUT
        );

        it(
            'concrete target >= 1.21.120 manifest "beta"',
            async () => {
                const registry = DependencyResolverRegistry.fromConfig([]);
                const result = await registry.resolve(
                    ctx({ specifier: "beta", target: "1.26.32", npm })
                );
                console.log(
                    `  beta + 1.26.32 -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
                );
                expect(result.manifestVersion).toBe("beta");
            },
            NET_TIMEOUT
        );

        it(
            'concrete target < 1.21.120 manifest short "x.x.x-beta"',
            async () => {
                const registry = DependencyResolverRegistry.fromConfig([]);
                const result = await registry.resolve(
                    ctx({ specifier: "beta", target: "1.20.80", npm })
                );
                console.log(
                    `  beta + 1.20.80 -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
                );
                expect(result.manifestVersion).toMatch(/^\d+\.\d+\.\d+-beta$/);
            },
            NET_TIMEOUT
        );
    });

    // -----------------------------------------------------------------------
    // Vanilla-data: stable
    // -----------------------------------------------------------------------
    describe("minecraft-vanilla-data stable", () => {
        it(
            'target "latest" resolves to latest stable',
            async () => {
                const registry = DependencyResolverRegistry.fromConfig([]);
                const result = await registry.resolve(
                    vanillaCtx({ specifier: "stable", target: "latest", npm })
                );
                console.log(`  vanilla-data stable + latest -> package=${result.packageVersion}`);
                expect(result.packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
            },
            NET_TIMEOUT
        );
    });

    // -----------------------------------------------------------------------
    // Vanilla-data: preview
    // -----------------------------------------------------------------------
    describe("minecraft-vanilla-data preview", () => {
        it(
            'target "latest" resolves to latest preview',
            async () => {
                const registry = DependencyResolverRegistry.fromConfig([]);
                const result = await registry.resolve(
                    vanillaCtx({ specifier: "preview", target: "latest", npm })
                );
                console.log(`  vanilla-data preview + latest -> package=${result.packageVersion}`);
                expect(result.packageVersion).toMatch(/^\d+\.\d+\.\d+-preview\.\d+$/);
            },
            NET_TIMEOUT
        );

        it(
            'concrete target "1.26.40" resolves to highest 1.26.40-preview.*',
            async () => {
                const registry = DependencyResolverRegistry.fromConfig([]);
                const result = await registry.resolve(
                    vanillaCtx({ specifier: "preview", target: "1.26.40", npm })
                );
                console.log(`  vanilla-data preview + 1.26.40 -> package=${result.packageVersion}`);
                expect(result.packageVersion).toMatch(/^1\.26\.40-preview\.\d+$/);
            },
            NET_TIMEOUT
        );
    });

});
