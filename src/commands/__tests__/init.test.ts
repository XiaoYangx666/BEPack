import { describe, it, expect } from "vitest";
import { versionToString, parseVersionToTuple, validateScriptEntry } from "../init.js";

// ---------------------------------------------------------------------------
// versionToString
// ---------------------------------------------------------------------------

describe("versionToString", () => {
    it("converts array [1,0,0] to string", () => {
        expect(versionToString([1, 0, 0])).toBe("1.0.0");
    });
    it("passes through string", () => {
        expect(versionToString("1.0.0")).toBe("1.0.0");
    });
    it("returns undefined for null", () => {
        expect(versionToString(null)).toBeUndefined();
    });
    it("returns undefined for undefined", () => {
        expect(versionToString(undefined)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// parseVersionToTuple
// ---------------------------------------------------------------------------

describe("parseVersionToTuple", () => {
    it("parses array [1,2,3]", () => {
        expect(parseVersionToTuple([1, 2, 3])).toEqual([1, 2, 3]);
    });
    it("parses string 1.2.3", () => {
        expect(parseVersionToTuple("1.2.3")).toEqual([1, 2, 3]);
    });
    it("returns undefined for invalid string", () => {
        expect(parseVersionToTuple("abc")).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// validateScriptEntry (real function from init.ts)
// ---------------------------------------------------------------------------

describe("validateScriptEntry", () => {
    it('handles "scripts/main.js"', () => {
        expect(validateScriptEntry("scripts/main.js", "BP")).toBe("scripts/main.js");
    });

    it('handles "custom/app.js"', () => {
        expect(validateScriptEntry("custom/app.js", "BP")).toBe("custom/app.js");
    });

    it('handles "nested/output/index.js"', () => {
        expect(validateScriptEntry("nested/output/index.js", "BP")).toBe("nested/output/index.js");
    });

    it('handles root-level "main.js"', () => {
        // root-level is valid syntax-wise, init handles it separately
        expect(validateScriptEntry("main.js", "BP")).toBe("main.js");
    });

    it('rejects entry with ".."', () => {
        expect(() => validateScriptEntry("../outside/main.js", "BP")).toThrow(
            'must not contain ".."'
        );
    });

    it("rejects absolute entry", () => {
        expect(() => validateScriptEntry("/absolute/path/main.js", "BP")).toThrow(
            "must be a relative path"
        );
    });

    it("rejects non-.js entry", () => {
        expect(() => validateScriptEntry("scripts/main.ts", "BP")).toThrow("must end with .js");
    });

    it("rejects empty string", () => {
        expect(() => validateScriptEntry("", "BP")).toThrow("must be a non-empty string");
    });

    it("rejects non-string entry", () => {
        expect(() => validateScriptEntry(123 as any, "BP")).toThrow("must be a non-empty string");
    });

    it("normalizes Windows backslashes", () => {
        const result = validateScriptEntry("scripts\\main.js", "BP");
        expect(result).toBe("scripts/main.js");
    });

    it("rejects empty path segments (double slash)", () => {
        expect(() => validateScriptEntry("scripts//main.js", "BP")).toThrow(
            "must not contain empty segments"
        );
    });
});
