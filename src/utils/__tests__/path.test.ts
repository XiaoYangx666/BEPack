import { describe, it, expect } from "vitest";
import path from "node:path";
import {
    validateScriptOutputDir,
    ensureSafeEmptyDir,
    containsPath,
    getBpIncludeItems,
    deduplicatePaths,
} from "../path.js";
import { normalizeConfig } from "../../config/normalizeConfig.js";

// ---------------------------------------------------------------------------
// validateScriptOutputDir
// ---------------------------------------------------------------------------

describe("validateScriptOutputDir", () => {
    const bpRoot = "/project/bp";

    it.each([
        [".", "must be a non-empty relative path"],
        ["", "must be a non-empty relative path"],
        ["..", 'must not contain ".."'],
        ["../outside", 'must not contain ".."'],
        ["a/b/../../../../escape", 'must not contain ".."'],
        ["/etc", "must be a relative path"],
        ["C:\\Windows", "must be a relative path"],
    ])("rejects %j", (value, message) => {
        expect(() => validateScriptOutputDir(bpRoot, value)).toThrow(message);
    });

    it.each([
        ["scripts", "scripts"],
        ["custom/scripts", "custom/scripts"],
        ["./scripts", "scripts"],
        ["foo/../scripts", "scripts"],
        ["foo\\..\\scripts", "scripts"],
        ["foo\\bar", "foo/bar"],
    ])("normalizes %j to %j", (value, expected) => {
        expect(validateScriptOutputDir(bpRoot, value)).toBe(expected);
    });

    it("rejects output dir equal to source dir (containsPath match)", () => {
        const srcDir = path.resolve(bpRoot, "src");
        expect(() => validateScriptOutputDir(bpRoot, "src", srcDir)).toThrow(
            "dangerously overlaps"
        );
    });

    it("rejects output dir that is parent of source dir", () => {
        const srcDir = path.resolve(bpRoot, "generated/src");
        expect(() => validateScriptOutputDir(bpRoot, "generated", srcDir)).toThrow(
            "dangerously overlaps"
        );
    });

    it("allows output dir sibling of source dir", () => {
        const srcDir = path.resolve("/project", "src");
        expect(() => validateScriptOutputDir(bpRoot, "scripts", srcDir)).not.toThrow();
    });

    it("allows output dir inside source dir (subdir)", () => {
        const srcDir = path.resolve(bpRoot, "src");
        expect(() => validateScriptOutputDir(bpRoot, "src/build", srcDir)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// containsPath
// ---------------------------------------------------------------------------

describe("containsPath", () => {
    it("parent equals child", () => {
        expect(containsPath("/a/b", "/a/b")).toBe(true);
    });
    it("parent is ancestor", () => {
        expect(containsPath("/a/b", "/a/b/c")).toBe(true);
    });
    it("child is ancestor of parent", () => {
        expect(containsPath("/a/b/c", "/a/b")).toBe(false);
    });
    it("unrelated paths", () => {
        expect(containsPath("/a", "/b")).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// ensureSafeEmptyDir (containsPath-based)
// ---------------------------------------------------------------------------

describe("ensureSafeEmptyDir", () => {
    const bpRoot = "/project/bp";

    it("allows valid subdirectory", () => {
        expect(() => ensureSafeEmptyDir("/project/bp/scripts", bpRoot, "test")).not.toThrow();
    });

    it("rejects bp root (protected path equality)", () => {
        expect(() => ensureSafeEmptyDir("/project/bp", bpRoot, "test")).toThrow("protected path");
    });

    it("rejects output dir that contains protected path (hook-modified scenario)", () => {
        // output=bp/generated, protected=bp/generated/src
        expect(() =>
            ensureSafeEmptyDir("/project/bp/generated", bpRoot, "test", [
                "/project/bp/generated/src",
            ])
        ).toThrow("protected path");
    });

    it("rejects path outside bp root", () => {
        expect(() => ensureSafeEmptyDir("/tmp/evil", bpRoot, "test")).toThrow("not inside");
    });
});

// ---------------------------------------------------------------------------
// getBpIncludeItems
// ---------------------------------------------------------------------------

describe("getBpIncludeItems", () => {
    function makeConfig(opts: { scriptOutputDir?: string; include?: string[] } = {}) {
        return normalizeConfig({
            name: "test",
            packs: {
                bp: {
                    root: "bp",
                    uuid: "a",
                    moduleUuid: "b",
                    include: opts.include ?? [],
                    compile: {
                        entry: "src/main.ts",
                        scriptOutputDir: opts.scriptOutputDir ?? "scripts",
                    },
                },
            },
        });
    }

    it("default items contain scripts", () => {
        expect(getBpIncludeItems(makeConfig())).toContain("scripts");
    });
    it("custom dir replaces scripts", () => {
        const items = getBpIncludeItems(makeConfig({ scriptOutputDir: "build_scripts" }));
        expect(items).toContain("build_scripts");
        expect(items).not.toContain("scripts");
    });
    it("deduplicates", () => {
        const items = getBpIncludeItems(makeConfig({ include: ["scripts"] }));
        expect(items.filter((i) => i === "scripts")).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------------
// deduplicatePaths
// ---------------------------------------------------------------------------

describe("deduplicatePaths", () => {
    it("removes duplicates preserving order", () => {
        expect(deduplicatePaths(["/z", "/a", "/z", "/b"])).toEqual(["/z", "/a", "/b"]);
    });
    it("handles empty", () => {
        expect(deduplicatePaths([])).toEqual([]);
    });
});
