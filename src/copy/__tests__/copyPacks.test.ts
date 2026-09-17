import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import { parseBrarchive } from "../../pack/brarchive.js";
import { copyPacks } from "../copyPacks.js";

type CopyOptimize = boolean | Record<string, unknown>;

describe("copyPacks", () => {
    it("refuses a destination that is the source pack itself", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-copy-"));
        try {
            mkdirSync(path.join(temp, "bp"));
            const config = normalizeConfig(
                {
                    root: temp,
                    name: "bp",
                    packs: { bp: { root: "bp", uuid: "bp-uuid" } },
                    copy: {
                        defaultTarget: "same",
                        targets: { same: { type: "custom", bp: temp } },
                    },
                },
                {},
                temp
            );

            await expect(copyPacks(temp, config)).rejects.toMatchObject({ code: "COPY_FAILED" });
            expect(existsSync(path.join(temp, "bp"))).toBe(true);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("refuses a configured folder name that escapes the copy target", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-copy-"));
        try {
            const source = path.join(temp, "bp");
            const target = path.join(temp, "target");
            mkdirSync(source);
            mkdirSync(target);
            const config = normalizeConfig(
                {
                    root: temp,
                    name: "bp",
                    packs: { bp: { root: "bp", uuid: "bp-uuid" } },
                    copy: {
                        defaultTarget: "dev",
                        name: "../outside-target",
                        targets: { dev: { type: "custom", bp: target } },
                    },
                },
                {},
                temp
            );

            await expect(copyPacks(temp, config, undefined, true)).rejects.toMatchObject({
                code: "COPY_FAILED",
            });
            expect(existsSync(source)).toBe(true);
            expect(existsSync(target)).toBe(true);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});

// ---------------------------------------------------------------------------
// copy.optimize — mirror the packaged __brarchive layout in the dev folder
// ---------------------------------------------------------------------------

function makeProject(options: {
    minEngineVersion?: number[] | string;
    optimize?: CopyOptimize;
    rpInclude?: string[];
}): { temp: string; target: string; source: string } {
    const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-copy-opt-"));
    const source = path.join(temp, "bp");
    const target = path.join(temp, "target");
    mkdirSync(path.join(source, "entities"), { recursive: true });
    mkdirSync(path.join(source, "scripts"), { recursive: true });
    mkdirSync(target, { recursive: true });
    writeFileSync(
        path.join(source, "manifest.json"),
        JSON.stringify({
            format_version: 2,
            header: {
                name: "Copy test",
                uuid: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
                version: [1, 0, 0],
                min_engine_version: options.minEngineVersion ?? [1, 26, 40],
            },
            modules: [
                {
                    type: "data",
                    uuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
                    version: [1, 0, 0],
                },
            ],
        })
    );
    writeFileSync(
        path.join(source, "entities", "zombie.json"),
        '{ "minecraft:entity" : { "description": {} } }'
    );
    writeFileSync(path.join(source, "scripts", "main.js"), "console.warn(1);\n");
    return { temp, target, source };
}

function configFor(temp: string, target: string, optimize: CopyOptimize | undefined) {
    return normalizeConfig(
        {
            root: temp,
            name: "copy-opt",
            packs: { bp: { root: "bp", uuid: "bp-uuid" } },
            copy: {
                defaultTarget: "dev",
                targets: { dev: { type: "custom", bp: target } },
                ...(optimize === undefined ? {} : { optimize }),
            },
        },
        {},
        temp
    );
}

describe("copyPacks with copy.optimize", () => {
    it("writes __brarchive archives instead of the loose files", async () => {
        const { temp, target } = makeProject({ optimize: true });
        try {
            const config = configFor(temp, target, true);
            expect(config.copy.optimize).toMatchObject({ keepLooseFiles: false, minifyJson: true });

            await copyPacks(temp, config);

            const dev = path.join(target, "copy-opt");
            expect(existsSync(path.join(dev, "__brarchive", "entities.brarchive"))).toBe(true);
            expect(existsSync(path.join(dev, "__brarchive", "scripts.brarchive"))).toBe(true);
            expect(existsSync(path.join(dev, "entities"))).toBe(false);
            expect(existsSync(path.join(dev, "scripts"))).toBe(false);
            // Root files stay loose, and the manifest declares the optimization
            expect(existsSync(path.join(dev, "manifest.json"))).toBe(true);
            const manifest = JSON.parse(readFileSync(path.join(dev, "manifest.json"), "utf8"));
            expect(manifest.header.pack_optimization_version).toBe("0.1.0");

            const entries = parseBrarchive(
                new Uint8Array(readFileSync(path.join(dev, "__brarchive", "entities.brarchive")))
            );
            expect(entries.map((entry) => entry.name)).toEqual(["zombie.json"]);
            expect(JSON.parse(new TextDecoder().decode(entries[0]!.data))).toEqual({
                "minecraft:entity": { description: {} },
            });
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("keeps copying loose files when optimize is off", async () => {
        const { temp, target } = makeProject({});
        try {
            await copyPacks(temp, configFor(temp, target, undefined));
            const dev = path.join(target, "copy-opt");
            expect(existsSync(path.join(dev, "entities", "zombie.json"))).toBe(true);
            expect(existsSync(path.join(dev, "__brarchive"))).toBe(false);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("lets the CLI override enable and disable it", async () => {
        const enabled = makeProject({});
        try {
            await copyPacks(
                enabled.temp,
                configFor(enabled.temp, enabled.target, undefined),
                undefined,
                false,
                undefined,
                {
                    optimize: true,
                }
            );
            expect(
                existsSync(
                    path.join(enabled.target, "copy-opt", "__brarchive", "entities.brarchive")
                )
            ).toBe(true);
        } finally {
            rmSync(enabled.temp, { recursive: true, force: true });
        }

        const disabled = makeProject({ optimize: true });
        try {
            await copyPacks(
                disabled.temp,
                configFor(disabled.temp, disabled.target, true),
                undefined,
                false,
                undefined,
                { optimize: false }
            );
            const dev = path.join(disabled.target, "copy-opt");
            expect(existsSync(path.join(dev, "entities", "zombie.json"))).toBe(true);
            expect(existsSync(path.join(dev, "__brarchive"))).toBe(false);
        } finally {
            rmSync(disabled.temp, { recursive: true, force: true });
        }
    });

    it("keeps loose files when keepLooseFiles is set", async () => {
        const { temp, target } = makeProject({ optimize: { keepLooseFiles: true } });
        try {
            await copyPacks(temp, configFor(temp, target, { keepLooseFiles: true }));
            const dev = path.join(target, "copy-opt");
            expect(existsSync(path.join(dev, "entities", "zombie.json"))).toBe(true);
            expect(existsSync(path.join(dev, "__brarchive", "entities.brarchive"))).toBe(true);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("optimizes even when min_engine_version predates archive support", async () => {
        const { temp, target } = makeProject({
            minEngineVersion: [1, 21, 0],
            optimize: true,
        });
        try {
            await copyPacks(temp, configFor(temp, target, true));
            expect(
                existsSync(path.join(target, "copy-opt", "__brarchive", "entities.brarchive"))
            ).toBe(true);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("uses the pack manifest on disk when the include list omits it", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-copy-opt-"));
        try {
            const source = path.join(temp, "rp");
            const target = path.join(temp, "target");
            mkdirSync(path.join(source, "models", "entity"), { recursive: true });
            mkdirSync(target, { recursive: true });
            writeFileSync(
                path.join(source, "manifest.json"),
                JSON.stringify({
                    format_version: 2,
                    header: {
                        name: "RP",
                        uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                        version: [1, 0, 0],
                        min_engine_version: "1.26.40",
                    },
                    modules: [
                        {
                            type: "resources",
                            uuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                            version: [1, 0, 0],
                        },
                    ],
                })
            );
            writeFileSync(path.join(source, "models", "entity", "x.geo.json"), "{}");

            const config = normalizeConfig(
                {
                    root: temp,
                    name: "rp-opt",
                    packs: {
                        rp: {
                            root: "rp",
                            uuid: "cccccccc-cccc-cccc-cccc-cccccccccccc",
                            moduleUuid: "dddddddd-dddd-dddd-dddd-dddddddddddd",
                            include: ["models"],
                        },
                    },
                    copy: {
                        defaultTarget: "dev",
                        targets: { dev: { type: "custom", rp: target } },
                        optimize: true,
                    },
                },
                {},
                temp
            );

            await copyPacks(temp, config);

            const dev = path.join(target, "rp-opt");
            // `models/entity/` mirrors into `__brarchive/models/entity.brarchive`
            expect(readdirSync(path.join(dev, "__brarchive"))).toContain("models");
            expect(existsSync(path.join(dev, "__brarchive", "models", "entity.brarchive"))).toBe(
                true
            );
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});
