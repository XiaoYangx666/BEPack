import { describe, it, expect } from "vitest";
import { versionToString, parseVersionToTuple, validateScriptEntry } from "../init.js";

// ---------------------------------------------------------------------------
// versionToString
// ---------------------------------------------------------------------------

describe("versionToString", () => {
    it.each([
        [[1, 0, 0], "1.0.0"],
        ["1.0.0", "1.0.0"],
        [null, undefined],
        [undefined, undefined],
    ])("converts %j", (value, expected) => {
        expect(versionToString(value)).toBe(expected);
    });
});

// ---------------------------------------------------------------------------
// parseVersionToTuple
// ---------------------------------------------------------------------------

describe("parseVersionToTuple", () => {
    it.each([
        [
            [1, 2, 3],
            [1, 2, 3],
        ],
        ["1.2.3", [1, 2, 3]],
        ["abc", undefined],
    ])("parses %j", (value, expected) => {
        expect(parseVersionToTuple(value)).toEqual(expected);
    });
});

// ---------------------------------------------------------------------------
// validateScriptEntry (real function from init.ts)
// ---------------------------------------------------------------------------

describe("validateScriptEntry", () => {
    it.each([
        ["scripts/main.js", "scripts/main.js"],
        ["custom/app.js", "custom/app.js"],
        ["nested/output/index.js", "nested/output/index.js"],
        ["main.js", "main.js"],
        ["scripts\\main.js", "scripts/main.js"],
    ])("normalizes %j", (entry, expected) => {
        expect(validateScriptEntry(entry, "BP")).toBe(expected);
    });

    it.each([
        ["../outside/main.js", 'must not contain ".."'],
        ["/absolute/path/main.js", "must be a relative path"],
        ["scripts/main.ts", "must end with .js"],
        ["", "must be a non-empty string"],
        [123, "must be a non-empty string"],
        ["scripts//main.js", "must not contain empty segments"],
    ])("rejects %j", (entry, message) => {
        expect(() => validateScriptEntry(entry, "BP")).toThrow(message);
    });
});
