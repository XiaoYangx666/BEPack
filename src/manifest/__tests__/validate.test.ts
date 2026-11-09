import { describe, expect, it } from "vitest";
import { BePackError } from "../../errors/BePackError.js";
import type { Manifest } from "../types.js";
import { validateManifest } from "../validate.js";

function validManifest(): Manifest {
    return {
        format_version: 2,
        header: {
            name: "Test",
            description: "Test pack",
            uuid: "11111111-1111-4111-8111-111111111111",
            version: [1, 0, 0],
            min_engine_version: [1, 21, 0],
        },
        modules: [
            {
                type: "data",
                uuid: "22222222-2222-4222-8222-222222222222",
                version: [1, 0, 0],
            },
        ],
    };
}

function captureError(run: () => void): BePackError {
    try {
        run();
    } catch (error) {
        expect(error).toBeInstanceOf(BePackError);
        return error as BePackError;
    }
    throw new Error("Expected validateManifest to throw.");
}

/**
 * The rules live in `@bepack/addon/core`; these tests pin the CLI contract:
 * `AddonError` must always surface as `BePackError("MANIFEST_INVALID")`.
 */
describe("validateManifest adapter", () => {
    it("accepts a valid manifest without throwing", () => {
        expect(() => validateManifest(validManifest(), "bp")).not.toThrow();
    });

    it("maps shared validation failures to MANIFEST_INVALID", () => {
        const error = captureError(() => validateManifest({ format_version: 2 } as Manifest, "bp"));

        expect(error.code).toBe("MANIFEST_INVALID");
        expect(error.message).toContain("Manifest validation failed");
        expect(error.message).toContain("header is required");
        expect(error.details).toBeUndefined();
    });

    it("preserves the pack-kind specific rules", () => {
        const manifest = validManifest();
        manifest.modules = [
            {
                type: "script",
                language: "javascript",
                uuid: "33333333-3333-4333-8333-333333333333",
                version: [1, 0, 0],
                entry: "scripts/main.js",
            },
        ];

        const error = captureError(() => validateManifest(manifest, "rp"));

        expect(error.code).toBe("MANIFEST_INVALID");
        expect(error.message).toContain("must have a resources module");
    });

    it("reports every rule violation in one error", () => {
        const manifest = validManifest();
        manifest.header = { version: [1, 0, 0] };
        manifest.capabilities = "pbr" as unknown as string[];

        const error = captureError(() => validateManifest(manifest, "bp"));

        expect(error.code).toBe("MANIFEST_INVALID");
        expect(error.message).toContain("header.name is required");
        expect(error.message).toContain("header.uuid is required");
        expect(error.message).toContain("capabilities must be an array");
    });
});
