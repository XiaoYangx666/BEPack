import { describe, it, expect } from "vitest";
import { versionToString, parseVersionToTuple, validateScriptEntry } from "../init.js";

describe("versionToString", () => {
    it.each([
        [[1, 2, 3], "1.2.3"],
        ["1.2.3", "1.2.3"],
        [undefined, undefined],
        [null, undefined],
        [[], ""],
        [42, undefined],
    ])("converts %j", (value, expected) => {
        expect(versionToString(value)).toBe(expected);
    });
});

describe("parseVersionToTuple", () => {
    it.each([
        [[1, 2, 3], [1, 2, 3]],
        ["1.26.30", [1, 26, 30]],
        ["", undefined],
        ["abc", undefined],
        [undefined, undefined],
        [null, undefined],
        [42, undefined],
        [[1, 2], undefined],
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
