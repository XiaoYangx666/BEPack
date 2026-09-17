import { describe, expect, it } from "vitest";
import { PACK_OPTIMIZE_DEFAULTS } from "../../config/defaultConfig.js";
import type { PackOptimizeResolved } from "../../config/configTypes.js";
import { parseBrarchive } from "../brarchive.js";
import { optimizePackFiles } from "../optimizePack.js";
import type { FileMap } from "../zip.js";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function files(entries: Record<string, string | Uint8Array>): FileMap {
    const map: FileMap = {};
    for (const [name, value] of Object.entries(entries)) {
        map[name] = typeof value === "string" ? encoder.encode(value) : value;
    }
    return map;
}

function manifest(minEngineVersion: unknown = [1, 26, 40], moduleType = "data"): string {
    return JSON.stringify({
        format_version: 2,
        header: {
            name: "Test",
            uuid: "uuid",
            version: [1, 0, 0],
            ...(minEngineVersion === null ? {} : { min_engine_version: minEngineVersion }),
        },
        modules: [{ type: moduleType, uuid: "module", version: [1, 0, 0] }],
    });
}

function options(overrides: Partial<PackOptimizeResolved> = {}): PackOptimizeResolved {
    return { ...PACK_OPTIMIZE_DEFAULTS, ...overrides };
}

function namesIn(output: FileMap, archive: string): string[] {
    const data = output[archive];
    if (!data) throw new Error(`missing archive ${archive}; got ${Object.keys(output).join(", ")}`);
    return parseBrarchive(data).map((entry) => entry.name);
}

function entryText(output: FileMap, archive: string, name: string): string {
    const entry = parseBrarchive(output[archive]!).find((item) => item.name === name);
    if (!entry) throw new Error(`missing entry ${name}`);
    return decoder.decode(entry.data);
}

describe("optimizePackFiles", () => {
    it("mirrors the directory tree into __brarchive archives", () => {
        const output = optimizePackFiles(
            files({
                "manifest.json": manifest(),
                "entities/zombie.json": '{"minecraft:entity":{}}',
                "entities/sub/other.json": "{}",
                "blocks/a.json": "{}",
                "pack_icon.png": new Uint8Array([1, 2, 3]),
            }),
            options()
        );

        expect(Object.keys(output).sort()).toEqual([
            "__brarchive/blocks.brarchive",
            "__brarchive/entities.brarchive",
            "__brarchive/entities/sub.brarchive",
            "manifest.json",
            "pack_icon.png",
        ]);
        expect(namesIn(output, "__brarchive/entities.brarchive")).toEqual(["zombie.json"]);
        expect(namesIn(output, "__brarchive/entities/sub.brarchive")).toEqual(["other.json"]);
        expect(namesIn(output, "__brarchive/blocks.brarchive")).toEqual(["a.json"]);
        // Loose copies are dropped from the artifact (source files are untouched)
        expect(output["entities/zombie.json"]).toBeUndefined();
    });

    it("archives path-addressed folders but keeps a loose copy", () => {
        const output = optimizePackFiles(
            files({
                "manifest.json": manifest(),
                "scripts/main.js": "console.warn(1);",
                "texts/en_US.lang": "pack.name=Test",
                "textures/blocks/stone.png": new Uint8Array([0]),
                "loot_tables/chests/x.json": "{}",
                "entities/zombie.json": "{}",
            }),
            options()
        );

        expect(Object.keys(output).sort()).toEqual([
            "__brarchive/entities.brarchive",
            "__brarchive/loot_tables/chests.brarchive",
            "__brarchive/scripts.brarchive",
            "__brarchive/texts.brarchive",
            "__brarchive/textures/blocks.brarchive",
            "loot_tables/chests/x.json",
            "manifest.json",
            "texts/en_US.lang",
        ]);
        // scripts/ and textures/ are archive-only; texts/ and loot_tables/ are duplicated
        expect(output["scripts/main.js"]).toBeUndefined();
        expect(output["textures/blocks/stone.png"]).toBeUndefined();
        expect(namesIn(output, "__brarchive/loot_tables/chests.brarchive")).toEqual(["x.json"]);
        // Path-addressed entries are name-only stubs; their content stays on disk
        expect(
            parseBrarchive(output["__brarchive/loot_tables/chests.brarchive"]!)[0]!.data.length
        ).toBe(0);
        // Archive-only entries carry the real (minified) content
        expect(parseBrarchive(output["__brarchive/scripts.brarchive"]!)[0]!.data.length).toBe(
            "console.warn(1);".length
        );
    });

    it("uses the resource-pack keep-loose defaults", () => {
        const output = optimizePackFiles(
            files({
                "manifest.json": manifest([1, 26, 40], "resources"),
                "models/entity/x.geo.json": "{}",
                "entity/zombie.entity.json": "{}",
                "textures/blocks/stone.png": new Uint8Array([0]),
                "texts/en_US.lang": "x=1",
                "sounds/sound_definitions.json": "{}",
                "loot_tables/x.json": "{}",
            }),
            options()
        );

        expect(Object.keys(output).sort()).toEqual([
            "__brarchive/entity.brarchive",
            "__brarchive/loot_tables.brarchive",
            "__brarchive/models/entity.brarchive",
            "__brarchive/sounds.brarchive",
            "__brarchive/texts.brarchive",
            "__brarchive/textures/blocks.brarchive",
            "manifest.json",
            "sounds/sound_definitions.json",
            "texts/en_US.lang",
            "textures/blocks/stone.png",
        ]);
    });

    it("keeps nothing extra when keepLoose is false", () => {
        const output = optimizePackFiles(
            files({
                "manifest.json": manifest(),
                "entities/zombie.json": "{}",
                "texts/en_US.lang": "x=1",
            }),
            options({ keepLoose: false })
        );
        expect(Object.keys(output).sort()).toEqual([
            "__brarchive/entities.brarchive",
            "__brarchive/texts.brarchive",
            "manifest.json",
        ]);
    });

    it("appends extra folders to the keep-loose defaults", () => {
        const output = optimizePackFiles(
            files({ "manifest.json": manifest(), "entities/zombie.json": "{}" }),
            options({ keepLoose: ["entities"] })
        );
        expect(Object.keys(output).sort()).toEqual([
            "__brarchive/entities.brarchive",
            "entities/zombie.json",
            "manifest.json",
        ]);
    });

    it("adds extra excluded folders from the options", () => {
        const output = optimizePackFiles(
            files({ "manifest.json": manifest(), "blocks/a.json": "{}" }),
            options({ exclude: ["blocks"] })
        );
        expect(Object.keys(output).sort()).toEqual(["blocks/a.json", "manifest.json"]);
    });

    it("keeps every loose file when keepLooseFiles is enabled", () => {
        const output = optimizePackFiles(
            files({ "manifest.json": manifest(), "entities/zombie.json": "{}" }),
            options({ keepLooseFiles: true })
        );
        expect(Object.keys(output).sort()).toEqual([
            "__brarchive/entities.brarchive",
            "entities/zombie.json",
            "manifest.json",
        ]);
    });

    it("passes existing __brarchive content through untouched", () => {
        const existing = new Uint8Array([1, 2, 3, 4]);
        const output = optimizePackFiles(
            files({ "manifest.json": manifest(), "__brarchive/entities.brarchive": existing }),
            options()
        );
        expect(output["__brarchive/entities.brarchive"]).toBe(existing);
    });

    it("minifies JSON entries and leaves everything else verbatim", () => {
        const output = optimizePackFiles(
            files({
                "manifest.json": manifest(),
                "entities/large.json": '{ "minecraft:entity" :\n  { "a": 1 } }',
                "entities/broken.json": "{ not json",
                "entities/notes.txt": "  keep   spacing  ",
            }),
            options()
        );

        expect(entryText(output, "__brarchive/entities.brarchive", "large.json")).toBe(
            '{"minecraft:entity":{"a":1}}'
        );
        expect(entryText(output, "__brarchive/entities.brarchive", "broken.json")).toBe(
            "{ not json"
        );
        expect(entryText(output, "__brarchive/entities.brarchive", "notes.txt")).toBe(
            "  keep   spacing  "
        );
    });

    it("warns instead of silently skipping a JSON entry it cannot minify", () => {
        const warnings: string[] = [];
        const output = optimizePackFiles(
            files({
                "manifest.json": manifest(),
                "entities/broken.json": "{ not json",
                "entities/large.json": '{ "a" : 1 }',
            }),
            options(),
            { pack: () => {}, warn: (message) => warnings.push(message) }
        );

        // The broken entry is still stored verbatim, but no longer invisibly.
        expect(entryText(output, "__brarchive/entities.brarchive", "broken.json")).toBe(
            "{ not json"
        );
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain("broken.json");
        expect(warnings[0]).toContain("storing it unchanged");
    });

    it("minifies JSON entries encoded as UTF-16 with a BOM", () => {
        const source = '{ "a" : 1 }';
        const utf16le = new Uint8Array([
            0xff,
            0xfe,
            ...Array.from(source, (char) => [char.charCodeAt(0) & 0xff, char.charCodeAt(0) >> 8]).flat(),
        ]);
        const output = optimizePackFiles(
            files({ "manifest.json": manifest(), "entities/le.json": utf16le }),
            options()
        );
        expect(entryText(output, "__brarchive/entities.brarchive", "le.json")).toBe('{"a":1}');
    });

    it("does not warn for non-JSON entries", () => {
        const warnings: string[] = [];
        optimizePackFiles(
            files({ "manifest.json": manifest(), "entities/notes.txt": "  keep  " }),
            options(),
            { pack: () => {}, warn: (message) => warnings.push(message) }
        );
        expect(warnings).toEqual([]);
    });

    it("keeps JSON readable when minifyJson is disabled", () => {
        const raw = '{ "a" : 1 }';
        const output = optimizePackFiles(
            files({ "manifest.json": manifest(), "entities/a.json": raw }),
            options({ minifyJson: false })
        );
        expect(entryText(output, "__brarchive/entities.brarchive", "a.json")).toBe(raw);
    });

    it("produces a stable key order", () => {
        const input = files({
            "manifest.json": manifest(),
            "texts/b.lang": "b",
            "entities/b.json": "{}",
            "entities/a.json": "{}",
        });
        const first = Object.keys(optimizePackFiles(input, options()));
        const second = Object.keys(optimizePackFiles(input, options()));
        expect(first).toEqual(second);
        expect(first).toEqual([...first].sort());
    });
});

describe("optimizePackFiles engine version gate", () => {
    it("accepts min_engine_version 1.26.40 as array or string", () => {
        for (const version of [[1, 26, 40], "1.26.40", [1, 27, 0]]) {
            const output = optimizePackFiles(
                files({ "manifest.json": manifest(version), "entities/a.json": "{}" }),
                options()
            );
            expect(Object.keys(output)).toContain("__brarchive/entities.brarchive");
        }
    });

    it("warns (but still optimizes) when min_engine_version is older", () => {
        const warnings: string[] = [];
        const output = optimizePackFiles(
            files({ "manifest.json": manifest([1, 21, 0]), "entities/a.json": "{}" }),
            options(),
            { pack: () => {}, warn: (message) => warnings.push(message) }
        );
        expect(Object.keys(output)).toContain("__brarchive/entities.brarchive");
        expect(warnings[0]).toMatch(/below 1\.26\.40/);
    });

    it("warns when the manifest declares no min_engine_version", () => {
        const warnings: string[] = [];
        optimizePackFiles(
            files({ "manifest.json": manifest(null), "entities/a.json": "{}" }),
            options(),
            { pack: () => {}, warn: (message) => warnings.push(message) }
        );
        expect(warnings[0]).toMatch(/not declared/);
    });

    it("stays silent when allowUnsupportedTarget is set", () => {
        const warnings: string[] = [];
        const output = optimizePackFiles(
            files({ "manifest.json": manifest([1, 21, 0]), "entities/a.json": "{}" }),
            options({ allowUnsupportedTarget: true }),
            { pack: () => {}, warn: (message) => warnings.push(message) }
        );
        expect(Object.keys(output)).toContain("__brarchive/entities.brarchive");
        expect(warnings).toEqual([]);
    });

    it("reports the number of archives it created", () => {
        const messages: string[] = [];
        optimizePackFiles(
            files({
                "manifest.json": manifest(),
                "entities/a.json": "{}",
                "blocks/b.json": "{}",
                "scripts/main.js": "x;",
            }),
            options(),
            { pack: (message) => messages.push(message), warn: () => {} }
        );
        expect(messages[0]).toMatch(/3 archives/);
        expect(messages[0]).toMatch(/3 files archived/);
    });

    it("uses singular wording for a single archived file", () => {
        const messages: string[] = [];
        optimizePackFiles(
            files({ "manifest.json": manifest(), "entities/a.json": "{}" }),
            options(),
            { pack: (message) => messages.push(message), warn: () => {} }
        );
        expect(messages[0]).toMatch(/1 archive \(1 file archived/);
    });
});

describe("optimizePackFiles pack_optimization_version", () => {
    it("writes the default version into the packaged manifest only", () => {
        const input = files({ "manifest.json": manifest(), "entities/a.json": "{}" });
        const output = optimizePackFiles(input, options());

        const packaged = JSON.parse(decoder.decode(output["manifest.json"]!));
        expect(packaged.header.pack_optimization_version).toBe("0.1.0");
        // The input map (what the pack on disk contains) is untouched
        expect(decoder.decode(input["manifest.json"]!)).not.toContain("pack_optimization_version");
    });

    it("honours a custom version", () => {
        const output = optimizePackFiles(
            files({ "manifest.json": manifest(), "entities/a.json": "{}" }),
            options({ packOptimizationVersion: "0.2.0" })
        );
        const packaged = JSON.parse(decoder.decode(output["manifest.json"]!));
        expect(packaged.header.pack_optimization_version).toBe("0.2.0");
    });

    it("falls back to the pack's on-disk manifest when the include list omits it", () => {
        const output = optimizePackFiles(
            files({ "entities/a.json": "{}" }),
            options(),
            undefined,
            encoder.encode(manifest())
        );
        const packaged = JSON.parse(decoder.decode(output["manifest.json"]!));
        expect(packaged.header.pack_optimization_version).toBe("0.1.0");
    });

    it("fails when the pack has no manifest at all", () => {
        expect(() =>
            optimizePackFiles(
                files({ "entities/a.json": "{}" }),
                options({ allowUnsupportedTarget: true })
            )
        ).toThrow(/needs a manifest\.json/);
    });

    it("fails when the manifest is not valid JSON", () => {
        expect(() =>
            optimizePackFiles(
                files({ "manifest.json": "{ nope", "entities/a.json": "{}" }),
                options({ allowUnsupportedTarget: true })
            )
        ).toThrow(/not valid JSON/);
    });
});
