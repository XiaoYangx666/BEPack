import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import type {
    DependencyResolverRule,
    LoggerLike,
    NpmPackageMetadata,
    ResolvedConfig,
    UserConfig,
} from "../../config/configTypes.js";
import type { NpmRegistryClient } from "../../utils/npmRegistry.js";
import { sapiPro } from "../sapiPro.js";

function mockNpm(packages: Record<string, NpmPackageMetadata>): NpmRegistryClient {
    return {
        metadata: async (packageName: string) => packages[packageName]!,
        versions: (metadata: NpmPackageMetadata) => Object.keys(metadata.versions ?? {}),
        distTag: (metadata: NpmPackageMetadata, tag: string) => metadata["dist-tags"]?.[tag],
    } as unknown as NpmRegistryClient;
}

function config(
    dependencies: Record<string, string>,
    target = "latest",
    install?: UserConfig["install"]
): ResolvedConfig {
    return normalizeConfig({
        name: "test",
        target,
        plugins: [sapiPro()],
        ...(install ? { install } : {}),
        packs: { bp: { root: "bp", uuid: "a", moduleUuid: "b", dependencies } },
    });
}

const customMinecraftResolver: DependencyResolverRule = {
    name: "custom-minecraft",
    resolver: "custom-minecraft",
    match: (ctx) =>
        ctx.packageName === "@minecraft/server" || ctx.packageName === "@minecraft/server-ui",
    async resolve(ctx) {
        const version = ctx.packageName === "@minecraft/server" ? "2.8.0" : "2.1.0";
        return { packageVersion: version, manifestVersion: version };
    },
};

async function resolve(
    resolved: ResolvedConfig,
    npm: NpmRegistryClient,
    logger?: LoggerLike
): Promise<{ packageVersion: string }> {
    const rule = resolved.install.dependencyResolvers[0]!;
    return await rule.resolve({
        packageName: "sapi-pro",
        specifier: resolved.packs.bp!.dependencies["sapi-pro"]!,
        target: resolved.target,
        entry: resolved.install.dependencyCatalog["sapi-pro"]!,
        config: resolved,
        npm,
        ...(logger ? { logger } : {}),
    });
}

function mockLogger(messages: string[]): LoggerLike {
    const noop = () => {};
    return {
        info: noop,
        warn: noop,
        error: noop,
        clear: noop,
        install: noop,
        verbose: (message) => messages.push(message),
    };
}

describe("sapiPro", () => {
    it("selects the highest compatible stable release", async () => {
        const npm = mockNpm({
            "sapi-pro": {
                versions: {
                    "0.4.0-stable.0": {
                        peerDependencies: {
                            "@minecraft/server": "^2.6.0",
                            "@minecraft/server-ui": "^2.0.0",
                        },
                    },
                    "0.4.1-stable": {
                        peerDependencies: {
                            "@minecraft/server": "^2.8.0",
                            "@minecraft/server-ui": "^2.1.0",
                        },
                    },
                },
            },
            "@minecraft/server": { "dist-tags": { latest: "2.8.0" }, versions: { "2.8.0": {} } },
            "@minecraft/server-ui": { "dist-tags": { latest: "2.1.0" }, versions: { "2.1.0": {} } },
        });
        const resolved = config({
            "sapi-pro": "stable",
            "@minecraft/server": "stable",
            "@minecraft/server-ui": "stable",
        });

        await expect(resolve(resolved, npm)).resolves.toEqual({
            packageVersion: "0.4.1-stable",
            manifestVersion: null,
        });
    });

    it("ignores peers of package-only dependencies that are not declared", async () => {
        // Regression: sapi-pro 0.4.3-stable peers on @minecraft/vanilla-data, which is
        // package-only (manifest: false) and therefore not listed in packs.bp.dependencies.
        // That must not push the resolver down to 0.4.1-stable.
        const npm = mockNpm({
            "sapi-pro": {
                versions: {
                    "0.4.1-stable": {
                        peerDependencies: {
                            "@minecraft/server": "^2.8.0",
                            "@minecraft/server-ui": "^2.1.0",
                        },
                    },
                    "0.4.3-stable": {
                        peerDependencies: {
                            "@minecraft/server": "^2.10.0",
                            "@minecraft/server-ui": "^2.2.0",
                            "@minecraft/vanilla-data": ">=1.26.0",
                        },
                    },
                },
            },
            "@minecraft/server": { "dist-tags": { latest: "2.11.0" }, versions: { "2.11.0": {} } },
            "@minecraft/server-ui": { "dist-tags": { latest: "2.3.0" }, versions: { "2.3.0": {} } },
        });
        const resolved = config({
            "sapi-pro": "stable",
            "@minecraft/server": "stable",
            "@minecraft/server-ui": "stable",
        });

        await expect(resolve(resolved, npm)).resolves.toEqual({
            packageVersion: "0.4.3-stable",
            manifestVersion: null,
        });
    });

    it("resolves beta sapi-pro when the package-only vanilla-data peer is undeclared", async () => {
        // Beta releases (0.4.0, 0.4.1, 0.4.2) all peer on @minecraft/vanilla-data.
        // Before the package-only fix this made the entire beta channel unresolvable.
        const npm = mockNpm({
            "sapi-pro": {
                versions: {
                    "0.4.1": {
                        peerDependencies: {
                            "@minecraft/server": "^2.9.0-beta.1.26.30-stable",
                            "@minecraft/server-ui": "^2.2.0-beta.1.26.30-stable",
                            "@minecraft/vanilla-data": ">=1.26.0",
                        },
                    },
                    "0.4.2": {
                        peerDependencies: {
                            "@minecraft/server": "^2.11.0-beta.1.26.50-stable",
                            "@minecraft/server-ui": "^2.3.0-beta.1.26.50-stable",
                            "@minecraft/vanilla-data": ">=1.26.0",
                        },
                    },
                },
            },
            "@minecraft/server": {
                "dist-tags": { beta: "2.12.0-beta.1.26.60-stable" },
                versions: { "2.12.0-beta.1.26.60-stable": {} },
            },
            "@minecraft/server-ui": {
                "dist-tags": { beta: "2.4.0-beta.1.26.60-stable" },
                versions: { "2.4.0-beta.1.26.60-stable": {} },
            },
        });
        const resolved = config({
            "sapi-pro": "beta",
            "@minecraft/server": "beta",
            "@minecraft/server-ui": "beta",
        });

        await expect(resolve(resolved, npm)).resolves.toEqual({
            packageVersion: "0.4.2",
            manifestVersion: null,
        });
    });

    it("still rejects candidates whose manifest dependencies are not declared", async () => {
        const npm = mockNpm({
            "sapi-pro": {
                versions: {
                    "0.4.3-stable": {
                        peerDependencies: {
                            "@minecraft/server": "^2.10.0",
                            "@minecraft/server-ui": "^2.2.0",
                            "@minecraft/server-net": "^1.0.0",
                        },
                    },
                },
            },
            "@minecraft/server": { "dist-tags": { latest: "2.11.0" }, versions: { "2.11.0": {} } },
            "@minecraft/server-ui": { "dist-tags": { latest: "2.3.0" }, versions: { "2.3.0": {} } },
        });
        const resolved = config({
            "sapi-pro": "stable",
            "@minecraft/server": "stable",
            "@minecraft/server-ui": "stable",
        });

        await expect(resolve(resolved, npm)).rejects.toThrow("@minecraft/server-net");
    });

    it("checks the version of explicitly declared package-only dependencies", async () => {
        const npm = mockNpm({
            "sapi-pro": {
                versions: {
                    "0.4.1-stable": {
                        peerDependencies: {
                            "@minecraft/server": "^2.8.0",
                            "@minecraft/server-ui": "^2.1.0",
                        },
                    },
                    "0.4.3-stable": {
                        peerDependencies: {
                            "@minecraft/server": "^2.10.0",
                            "@minecraft/server-ui": "^2.2.0",
                            "@minecraft/vanilla-data": ">=1.26.70",
                        },
                    },
                },
            },
            "@minecraft/server": { "dist-tags": { latest: "2.11.0" }, versions: { "2.11.0": {} } },
            "@minecraft/server-ui": { "dist-tags": { latest: "2.3.0" }, versions: { "2.3.0": {} } },
        });
        const resolved = config({
            "sapi-pro": "stable",
            "@minecraft/server": "stable",
            "@minecraft/server-ui": "stable",
            "@minecraft/vanilla-data": "1.26.60",
        });

        await expect(resolve(resolved, npm)).resolves.toEqual({
            packageVersion: "0.4.1-stable",
            manifestVersion: null,
        });
    });

    it("accepts a newer Minecraft target for beta peers", async () => {
        const npm = mockNpm({
            "sapi-pro": {
                versions: {
                    "0.4.1": {
                        peerDependencies: {
                            "@minecraft/server": "^2.9.0-beta.1.26.30-stable",
                            "@minecraft/server-ui": "^2.2.0-beta.1.26.30-stable",
                            "@minecraft/vanilla-data": ">=1.26.0",
                        },
                    },
                },
            },
            "@minecraft/server": {
                versions: { "2.9.0-beta.1.26.33-stable": {} },
            },
            "@minecraft/server-ui": {
                versions: { "2.2.0-beta.1.26.33-stable": {} },
            },
            "@minecraft/vanilla-data": { versions: { "1.26.0": {} } },
        });
        const resolved = config(
            {
                "sapi-pro": "beta",
                "@minecraft/server": "beta",
                "@minecraft/server-ui": "beta",
                "@minecraft/vanilla-data": "1.26.0",
            },
            "1.26.33"
        );

        await expect(resolve(resolved, npm)).resolves.toEqual({
            packageVersion: "0.4.1",
            manifestVersion: null,
        });
    });

    it("uses the project's catalog and resolver chain for peer compatibility", async () => {
        const npm = mockNpm({
            "sapi-pro": {
                versions: {
                    "0.4.1-stable": {
                        peerDependencies: {
                            "@minecraft/server": "^2.8.0",
                            "@minecraft/server-ui": "^2.1.0",
                        },
                    },
                },
            },
        });
        const resolved = config(
            {
                "sapi-pro": "stable",
                "@minecraft/server": "stable",
                "@minecraft/server-ui": "stable",
            },
            "latest",
            {
                dependencyCatalog: {
                    "@minecraft/server": { resolver: "custom-minecraft" },
                    "@minecraft/server-ui": { resolver: "custom-minecraft" },
                },
                dependencyResolvers: [customMinecraftResolver],
            }
        );

        await expect(resolve(resolved, npm)).resolves.toEqual({
            packageVersion: "0.4.1-stable",
            manifestVersion: null,
        });
    });

    it("requires users to explicitly declare server and server-ui", () => {
        const plugin = sapiPro();
        const resolved = config({ "sapi-pro": "stable" });
        expect(() => plugin.configResolved!({ cwd: process.cwd(), config: resolved })).toThrow(
            "@minecraft/server, @minecraft/server-ui"
        );
    });

    it("does not silently fall back to legacy releases", async () => {
        // Both the modern candidate (peer range too new for the resolved server) and the
        // legacy candidate (exact peer versions) are incompatible: report an error instead
        // of resolving 0.3.1 just because its metadata is less strict.
        const npm = mockNpm({
            "sapi-pro": {
                versions: {
                    "0.4.1": {
                        peerDependencies: {
                            "@minecraft/server": "^2.10.0-beta.1.26.30-stable",
                            "@minecraft/server-ui": "^2.2.0-beta.1.26.30-stable",
                        },
                    },
                    "0.3.1": {
                        dependencies: {
                            "@minecraft/server": "2.9.0-beta.1.26.30-stable",
                            "@minecraft/server-ui": "2.2.0-beta.1.26.30-stable",
                        },
                    },
                },
            },
            "@minecraft/server": { versions: { "2.9.0-beta.1.26.33-stable": {} } },
            "@minecraft/server-ui": { versions: { "2.2.0-beta.1.26.33-stable": {} } },
        });
        const resolved = config(
            {
                "sapi-pro": "beta",
                "@minecraft/server": "beta",
                "@minecraft/server-ui": "beta",
            },
            "1.26.33"
        );

        await expect(resolve(resolved, npm)).rejects.toThrow(
            "Cannot find a compatible sapi-pro@beta"
        );
    });

    it("resolves each Minecraft dependency only once while checking candidates", async () => {
        const messages: string[] = [];
        const npm = mockNpm({
            "sapi-pro": {
                versions: {
                    "0.4.0-stable.0": {
                        peerDependencies: {
                            "@minecraft/server": "^2.6.0",
                            "@minecraft/server-ui": "^2.0.0",
                        },
                    },
                    "0.4.1-stable": {
                        peerDependencies: {
                            "@minecraft/server": "^2.8.0",
                            "@minecraft/server-ui": "^2.1.0",
                        },
                    },
                },
            },
            "@minecraft/server": { "dist-tags": { latest: "2.6.0" }, versions: { "2.6.0": {} } },
            "@minecraft/server-ui": { "dist-tags": { latest: "2.0.0" }, versions: { "2.0.0": {} } },
        });
        const resolved = config({
            "sapi-pro": "stable",
            "@minecraft/server": "stable",
            "@minecraft/server-ui": "stable",
        });

        await expect(resolve(resolved, npm, mockLogger(messages))).resolves.toMatchObject({
            packageVersion: "0.4.0-stable.0",
        });
        expect(
            messages.filter(
                (message) =>
                    message.startsWith("Resolving @minecraft/server@") &&
                    message.includes(" with minecraft-script-api")
            )
        ).toHaveLength(1);
        expect(
            messages.filter(
                (message) =>
                    message.startsWith("Resolving @minecraft/server-ui@") &&
                    message.includes(" with minecraft-script-api")
            )
        ).toHaveLength(1);
    });

    it.each([
        ["beta", "stable", "beta", "@minecraft/server to use beta"],
        ["stable", "beta", "stable", "@minecraft/server to use stable"],
        ["beta", "beta", "stable", "@minecraft/server-ui to use beta"],
    ])(
        "requires sapi-pro %s to use matching Script API channels",
        (sapiSpecifier, serverSpecifier, uiSpecifier, message) => {
            const plugin = sapiPro();
            const resolved = config({
                "sapi-pro": sapiSpecifier,
                "@minecraft/server": serverSpecifier,
                "@minecraft/server-ui": uiSpecifier,
            });
            expect(() => plugin.configResolved!({ cwd: process.cwd(), config: resolved })).toThrow(
                message
            );
        }
    );
});
