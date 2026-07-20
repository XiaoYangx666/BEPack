import { describe, expect, it } from "vitest";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import type { NpmPackageMetadata, ResolvedConfig } from "../../config/configTypes.js";
import type { NpmRegistryClient } from "../../utils/npmRegistry.js";
import { sapiPro } from "../sapiPro.js";

function mockNpm(packages: Record<string, NpmPackageMetadata>): NpmRegistryClient {
    return {
        metadata: async (packageName: string) => packages[packageName]!,
        versions: (metadata: NpmPackageMetadata) => Object.keys(metadata.versions ?? {}),
        distTag: (metadata: NpmPackageMetadata, tag: string) => metadata["dist-tags"]?.[tag],
    } as unknown as NpmRegistryClient;
}

function config(dependencies: Record<string, string>, target = "latest"): ResolvedConfig {
    return normalizeConfig({
        name: "test",
        target,
        plugins: [sapiPro()],
        packs: { bp: { root: "bp", uuid: "a", moduleUuid: "b", dependencies } },
    });
}

async function resolve(
    resolved: ResolvedConfig,
    npm: NpmRegistryClient
): Promise<{ packageVersion: string }> {
    const rule = resolved.install.dependencyResolvers[0]!;
    return await rule.resolve({
        packageName: "sapi-pro",
        specifier: resolved.packs.bp!.dependencies["sapi-pro"]!,
        target: resolved.target,
        entry: resolved.install.dependencyCatalog["sapi-pro"]!,
        config: resolved,
        npm,
    });
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

    it("requires users to explicitly declare server and server-ui", () => {
        const plugin = sapiPro();
        const resolved = config({ "sapi-pro": "stable" });
        expect(() => plugin.configResolved!({ cwd: process.cwd(), config: resolved })).toThrow(
            "@minecraft/server, @minecraft/server-ui"
        );
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
