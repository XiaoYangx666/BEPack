import { describe, it, expect } from "vitest";
import { NpmRegistryClient } from "../../utils/npmRegistry.js";

// Network tests hit the real npm registry; allow up to 15 s per request.
const NET_TIMEOUT = 15000;
import { DependencyResolverRegistry } from "../resolvers/minecraft.js";
import type { DependencyResolverContext, ResolvedConfig } from "../../config/configTypes.js";
import type { NpmClient } from "../MinecraftPackageResolver.js";

const REGISTRY = "https://registry.npmjs.org/";

function liveNpm(): NpmClient {
    return new NpmRegistryClient(REGISTRY);
}

function ctx(
    overrides: Partial<DependencyResolverContext> & { npm: NpmClient }
): DependencyResolverContext {
    return {
        packageName: "@minecraft/server",
        specifier: "stable",
        kind: "manifest",
        package: { kind: "manifest", resolver: "minecraft" },
        target: "latest",
        registry: REGISTRY,
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
    // stable
    // -----------------------------------------------------------------------
    describe("stable specifier", () => {
        it('target "latest" resolves to latest dist-tag (2.8.0)', async () => {
            const registry = DependencyResolverRegistry.fromConfig([]);
            const result = await registry.resolve(
                ctx({
                    specifier: "stable",
                    target: "latest",
                    npm,
                })
            );
            console.log(
                `  stable + latest -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
            );
            expect(result.packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
            expect(result.manifestVersion).toBe(result.packageVersion);
        });

        it("concrete target 1.26.32 infers stable from matching beta", async () => {
            const registry = DependencyResolverRegistry.fromConfig([]);
            const result = await registry.resolve(
                ctx({
                    specifier: "stable",
                    target: "1.26.32",
                    npm,
                })
            );
            console.log(
                `  stable + 1.26.32 -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
            );
            expect(result.packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
            // 2.9.0-beta.1.26.32-stable -> inferred 2.8.0
            expect(result.packageVersion).toBe("2.8.0");
        });

        it("concrete target 1.21.120 infers stable from matching beta", async () => {
            const registry = DependencyResolverRegistry.fromConfig([]);
            const result = await registry.resolve(
                ctx({
                    specifier: "stable",
                    target: "1.21.120",
                    npm,
                })
            );
            console.log(
                `  stable + 1.21.120 -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
            );
            expect(result.packageVersion).toMatch(/^\d+\.\d+\.\d+$/);
        });
    });

    // -----------------------------------------------------------------------
    // beta
    // -----------------------------------------------------------------------
    describe("beta specifier", () => {
        it('target "latest" returns beta dist-tag, manifest "beta"', async () => {
            const registry = DependencyResolverRegistry.fromConfig([]);
            const result = await registry.resolve(
                ctx({
                    specifier: "beta",
                    target: "latest",
                    npm,
                })
            );
            console.log(
                `  beta + latest -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
            );
            expect(result.manifestVersion).toBe("beta");
        });

        it('concrete target >= 1.21.120 manifest "beta"', async () => {
            const registry = DependencyResolverRegistry.fromConfig([]);
            const result = await registry.resolve(
                ctx({
                    specifier: "beta",
                    target: "1.26.32",
                    npm,
                })
            );
            console.log(
                `  beta + 1.26.32 -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
            );
            expect(result.manifestVersion).toBe("beta");
        });

        it('concrete target < 1.21.120 manifest short "x.x.x-beta"', async () => {
            const registry = DependencyResolverRegistry.fromConfig([]);
            const result = await registry.resolve(
                ctx({
                    specifier: "beta",
                    target: "1.20.80",
                    npm,
                })
            );
            console.log(
                `  beta + 1.20.80 -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
            );
            // manifest should be short form, not full npm version
            expect(result.manifestVersion).toMatch(/^\d+\.\d+\.\d+-beta$/);
        });
    });

    // -----------------------------------------------------------------------
    // exact version
    // -----------------------------------------------------------------------
    describe("exact version specifier", () => {
        it('resolves "2.6.0" as-is', async () => {
            const registry = DependencyResolverRegistry.fromConfig([]);
            const result = await registry.resolve(
                ctx({
                    specifier: "2.6.0",
                    package: { kind: "manifest" },
                    npm,
                })
            );
            console.log(
                `  exact 2.6.0 -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
            );
            expect(result.packageVersion).toBe("2.6.0");
            expect(result.manifestVersion).toBe("2.6.0");
        });

        it('vanilla-data "1.12.0" resolves as exact', async () => {
            const registry = DependencyResolverRegistry.fromConfig([]);
            const result = await registry.resolve(
                ctx({
                    packageName: "@minecraft/vanilla-data",
                    specifier: "1.12.0",
                    npm,
                })
            );
            console.log(`  vanilla-data 1.12.0 -> package=${result.packageVersion}`);
            expect(result.packageVersion).toBe("1.12.0");
        });
    });

    // -----------------------------------------------------------------------
    // package-only (no manifest version)
    // -----------------------------------------------------------------------
    describe("package-only dependency", () => {
        it("@minecraft/vanilla-data stable resolves with no manifestVersion", async () => {
            const registry = DependencyResolverRegistry.fromConfig([]);
            const result = await registry.resolve(
                ctx({
                    packageName: "@minecraft/vanilla-data",
                    specifier: "stable",
                    kind: "package",
                    package: { kind: "package", resolver: "minecraft" },
                    npm,
                })
            );
            console.log(
                `  vanilla-data stable -> package=${result.packageVersion}, manifest=${result.manifestVersion}`
            );
            expect(result.manifestVersion).toBeNull();
        });
    });
});
