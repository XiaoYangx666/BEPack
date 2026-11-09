import { describe, expect, it } from "vitest";
import { AddonError, validateManifest, type Manifest, type ManifestVersion } from "../src/index.js";

function validBp(overrides: Partial<Manifest> = {}): Manifest {
    return {
        format_version: 2,
        header: {
            name: "Test",
            uuid: "a",
            version: [1, 0, 0],
            min_engine_version: [1, 21, 0],
        },
        modules: [
            {
                type: "script",
                language: "javascript",
                uuid: "b",
                version: [1, 0, 0],
                entry: "main.js",
            },
        ],
        ...overrides,
    };
}

describe("validateManifest", () => {
    it("accepts a valid behavior pack", () => {
        expect(() => validateManifest(validBp(), "bp")).not.toThrow();
    });

    it("requires format_version", () => {
        const manifest = validBp();
        delete manifest.format_version;
        expect(() => validateManifest(manifest, "bp")).toThrow("format_version is required");
    });

    it("requires header fields", () => {
        const manifest = validBp();
        delete manifest.header;
        expect(() => validateManifest(manifest, "bp")).toThrow("header is required");
        expect(() =>
            validateManifest(
                {
                    ...validBp(),
                    header: { uuid: "a", version: [1, 0, 0] },
                },
                "bp"
            )
        ).toThrow("header.name is required");
        expect(() =>
            validateManifest(
                {
                    ...validBp(),
                    header: { name: "Test", version: [1, 0, 0] },
                },
                "bp"
            )
        ).toThrow("header.uuid is required");
    });

    it("requires a resources module for resource packs", () => {
        expect(() => validateManifest(validBp(), "rp")).toThrow(
            "RP manifest must have a resources module"
        );
    });

    it("enforces format 2 version arrays", () => {
        expect(() =>
            validateManifest(
                {
                    ...validBp(),
                    header: {
                        name: "Test",
                        uuid: "a",
                        version: "1.0.0",
                        min_engine_version: [1, 21, 0],
                    },
                },
                "bp"
            )
        ).toThrow("header.version must be [number, number, number] (format 2)");
    });

    it("enforces format 3 version strings", () => {
        expect(() =>
            validateManifest(
                {
                    ...validBp({ format_version: 3 }),
                    header: {
                        name: "Test",
                        uuid: "a",
                        version: [1, 0, 0],
                        min_engine_version: "1.21.0",
                    },
                },
                "bp"
            )
        ).toThrow('header.version must be SemVer string like "x.y.z" (format 3)');
    });

    it("validates uuid dependency versions", () => {
        expect(() =>
            validateManifest(
                validBp({
                    dependencies: [{ uuid: "c", version: "1.0.0" as unknown as ManifestVersion }],
                }),
                "bp"
            )
        ).toThrow("version must be [number, number, number] (format 2)");
    });

    it("validates capabilities and metadata", () => {
        expect(() =>
            validateManifest(validBp({ capabilities: "pbr" as unknown as string[] }), "bp")
        ).toThrow("capabilities must be an array");
        expect(() =>
            validateManifest(
                validBp({ metadata: null as unknown as Record<string, unknown> }),
                "bp"
            )
        ).toThrow("metadata must be an object");
    });

    it("throws AddonError with the shared message prefix", () => {
        const manifest = validBp();
        delete manifest.format_version;
        try {
            validateManifest(manifest, "bp");
            expect.unreachable();
        } catch (error) {
            expect(error).toBeInstanceOf(AddonError);
            expect((error as AddonError).code).toBe("ADDON_MANIFEST_INVALID");
            expect((error as Error).message).toContain("Manifest validation failed:");
        }
    });
});
