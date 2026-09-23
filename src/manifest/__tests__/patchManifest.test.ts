import { describe, expect, it, vi } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import { patchManifest } from "../patchManifest.js";
import type { PatchedManifestDependency, PatchManifestResult } from "../patchManifest.js";
import { ManifestDepManager } from "../ManifestDepManager.js";
import type { LoggerLike } from "../../config/configTypes.js";

const BP_UUID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const MODULE_UUID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeLogger() {
    return {
        info: vi.fn<(message: string) => void>(),
        warn: vi.fn<(message: string) => void>(),
        error: vi.fn<(message: string) => void>(),
        verbose: vi.fn<(message: string) => void>(),
        clear: vi.fn<() => void>(),
    } satisfies LoggerLike;
}

/** Create a temp project with a BP manifest holding `serverVersion` as a dependency. */
function makeProject(serverVersion: string): string {
    const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-manifest-"));
    mkdirSync(path.join(temp, "bp"), { recursive: true });
    writeFileSync(
        path.join(temp, "bp", "manifest.json"),
        JSON.stringify({
            format_version: 2,
            header: {
                name: "BP",
                description: "",
                uuid: BP_UUID,
                version: [1, 0, 0],
                min_engine_version: [1, 20, 0],
            },
            modules: [
                {
                    type: "script",
                    language: "javascript",
                    uuid: MODULE_UUID,
                    version: [1, 0, 0],
                    entry: "scripts/main.js",
                },
            ],
            dependencies: [{ module_name: "@minecraft/server", version: serverVersion }],
        })
    );
    return temp;
}

function configFor(temp: string, dependencies: Record<string, string>) {
    return normalizeConfig(
        {
            root: temp,
            name: "addon",
            packs: {
                bp: {
                    root: "bp",
                    uuid: BP_UUID,
                    moduleUuid: MODULE_UUID,
                    dependencies,
                },
            },
        },
        {},
        temp
    );
}

function readManifest(temp: string): any {
    return JSON.parse(readFileSync(path.join(temp, "bp", "manifest.json"), "utf8"));
}

function serverVersionOf(manifest: any): string {
    return manifest.dependencies.find((dep: any) => dep.module_name === "@minecraft/server")
        .version;
}

/** Managed dependency diagnostics from a patch result (BP is always configured here). */
function bpDependencies(result: PatchManifestResult): PatchedManifestDependency[] {
    return result.bpManifest!.dependencies!;
}

describe("patchManifest — managed dependency versions", () => {
    it("lets a concrete config specifier win over the value stored in the manifest", async () => {
        const temp = makeProject("7.7.7");
        try {
            const logger = makeLogger();
            const result = await patchManifest({
                cwd: temp,
                config: configFor(temp, { "@minecraft/server": "2.10.0" }),
                logger,
            });

            expect(serverVersionOf(readManifest(temp))).toBe("2.10.0");
            expect(bpDependencies(result)[0]).toMatchObject({
                module_name: "@minecraft/server",
                specifier: "2.10.0",
                version: "2.10.0",
                source: "config",
                previous: "7.7.7",
            });
            // The change is reported instead of being silent
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("7.7.7"));
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("lets a concrete config specifier win over an install-resolved version", async () => {
        const temp = makeProject("7.7.7");
        try {
            const manifest = await patchManifest({
                cwd: temp,
                config: configFor(temp, { "@minecraft/server": "9.9.9" }),
                resolvedDeps: { "@minecraft/server": "2.0.0" },
                logger: makeLogger(),
            });

            expect(serverVersionOf(readManifest(temp))).toBe("9.9.9");
            expect(bpDependencies(manifest)[0]!.source).toBe("config");
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("uses the install-resolved version for channel specifiers and reports it", async () => {
        const temp = makeProject("7.7.7");
        try {
            const result = await patchManifest({
                cwd: temp,
                config: configFor(temp, { "@minecraft/server": "stable" }),
                resolvedDeps: { "@minecraft/server": "2.0.0" },
                logger: makeLogger(),
            });

            expect(serverVersionOf(readManifest(temp))).toBe("2.0.0");
            expect(bpDependencies(result)[0]).toMatchObject({
                source: "install",
                previous: "7.7.7",
            });
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("reuses the manifest version for channel specifiers and says so out loud", async () => {
        const temp = makeProject("2.0.0");
        try {
            const logger = makeLogger();
            const result = await patchManifest({
                cwd: temp,
                config: configFor(temp, { "@minecraft/server": "stable" }),
                logger,
            });

            expect(serverVersionOf(readManifest(temp))).toBe("2.0.0");
            expect(bpDependencies(result)[0]!.source).toBe("manifest");
            expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("kept from manifest"));
            expect(String(logger.info.mock.calls[0]![0])).toContain("bepack install");
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("reports the version it would write without touching the file on dry-run", async () => {
        const temp = makeProject("7.7.7");
        try {
            const result = await patchManifest({
                cwd: temp,
                config: configFor(temp, { "@minecraft/server": "2.10.0" }),
                dryRun: true,
                logger: makeLogger(),
            });

            expect(serverVersionOf(readManifest(temp))).toBe("7.7.7");
            expect(bpDependencies(result)[0]!.version).toBe("2.10.0");
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});

describe("patchManifest — header.min_engine_version", () => {
    it("applies manifest.minEngineVersion in preserve mode", async () => {
        const temp = makeProject("2.10.0");
        try {
            const config = normalizeConfig(
                {
                    root: temp,
                    name: "addon",
                    packs: {
                        bp: {
                            root: "bp",
                            uuid: BP_UUID,
                            moduleUuid: MODULE_UUID,
                            dependencies: { "@minecraft/server": "2.10.0" },
                            manifest: { minEngineVersion: "1.26.0" },
                        },
                    },
                },
                {},
                temp
            );

            await patchManifest({ cwd: temp, config, logger: makeLogger() });

            expect(readManifest(temp).header.min_engine_version).toEqual([1, 26, 0]);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("keeps the existing value in preserve mode when nothing is configured", async () => {
        const temp = makeProject("2.10.0");
        try {
            await patchManifest({
                cwd: temp,
                config: configFor(temp, { "@minecraft/server": "2.10.0" }),
                logger: makeLogger(),
            });

            expect(readManifest(temp).header.min_engine_version).toEqual([1, 20, 0]);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});

describe("ManifestDepManager.resolveVersionDetail", () => {
    const base = { specifier: "stable", target: "1.21.90" };

    it("prefers config > install > manifest", () => {
        expect(
            ManifestDepManager.resolveVersionDetail({
                specifier: "2.10.0",
                target: "latest",
                resolvedVersion: "2.0.0",
                manifestVersion: "7.7.7",
            })
        ).toEqual({ version: "2.10.0", source: "config" });

        expect(
            ManifestDepManager.resolveVersionDetail({
                ...base,
                resolvedVersion: "2.0.0",
                manifestVersion: "7.7.7",
            })
        ).toEqual({ version: "2.0.0", source: "install" });

        expect(
            ManifestDepManager.resolveVersionDetail({ ...base, manifestVersion: "7.7.7" })
        ).toEqual({ version: "7.7.7", source: "manifest" });
    });

    it("throws when a channel specifier has no concrete version", () => {
        expect(() => ManifestDepManager.resolveVersionDetail(base)).toThrow(/bepack install/);
    });

    it("keeps the channel string when the target supports channel dependencies", () => {
        expect(
            ManifestDepManager.resolveVersionDetail({ specifier: "beta", target: "latest" })
        ).toEqual({ version: "beta", source: "config" });
    });

    it("keeps resolveVersion backwards compatible", () => {
        const options = { specifier: "stable", target: "1.21.90", resolvedVersion: "2.0.0" };
        expect(ManifestDepManager.resolveVersion(options)).toBe(
            ManifestDepManager.resolveVersionDetail(options).version
        );
    });
});
