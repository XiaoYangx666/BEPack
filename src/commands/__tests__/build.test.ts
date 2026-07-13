import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import { ensureSafeEmptyDir, containsPath, validateScriptOutputDir } from "../../utils/path.js";
import { assertSafeScriptOutputPath } from "../../build/runRolldown.js";

describe("containsPath", () => {
    it("returns true when parent equals child", () => {
        expect(containsPath("/a/b", "/a/b")).toBe(true);
    });

    it("returns true when parent is ancestor of child", () => {
        expect(containsPath("/a/b", "/a/b/c")).toBe(true);
    });

    it("returns false when child is ancestor of parent", () => {
        expect(containsPath("/a/b/c", "/a/b")).toBe(false);
    });

    it("returns false for unrelated paths", () => {
        expect(containsPath("/a/b", "/c/d")).toBe(false);
    });
});

describe("ensureSafeEmptyDir", () => {
    const bpRoot = "/project/bp";

    it("allows a valid subdirectory", () => {
        expect(() => ensureSafeEmptyDir("/project/bp/scripts", bpRoot, "test")).not.toThrow();
    });

    it("rejects the BP root", () => {
        expect(() => ensureSafeEmptyDir("/project/bp", bpRoot, "test")).toThrow("protected path");
    });

    it("rejects output that contains a protected path", () => {
        expect(() =>
            ensureSafeEmptyDir("/project/bp/generated", bpRoot, "test", [
                "/project/bp/generated/src",
            ])
        ).toThrow("protected path");
    });

    it("rejects paths outside the BP root", () => {
        expect(() => ensureSafeEmptyDir("/tmp/evil", bpRoot, "test")).toThrow("not inside");
    });
});

describe("validateScriptOutputDir", () => {
    const bpRoot = "/project/bp";

    it("normalizes backslashes before validation", () => {
        expect(validateScriptOutputDir(bpRoot, "foo\\..\\generated")).toBe("generated");
        expect(validateScriptOutputDir(bpRoot, "foo\\bar")).toBe("foo/bar");
    });

    it("rejects output containing the source directory", () => {
        expect(() =>
            validateScriptOutputDir(bpRoot, "generated", path.join(bpRoot, "generated", "src"))
        ).toThrow("dangerously overlaps");
    });
});

describe("assertSafeScriptOutputPath", () => {
    it("protects .git relative to the actual BP root", () => {
        const cwd = path.join(os.tmpdir(), "bepack-runtime-git");
        const config = normalizeConfig({
            name: "test",
            root: "project",
            packs: {
                bp: {
                    root: "..",
                    uuid: "a",
                    moduleUuid: "b",
                    compile: {
                        entry: "src/main.ts",
                        scriptOutputDir: ".git",
                    },
                },
            },
        });
        const entry = path.join(cwd, "project", "src", "main.ts");
        const outDir = path.join(cwd, ".git");

        expect(() => assertSafeScriptOutputPath(cwd, config, entry, outDir)).toThrow(
            ".git metadata"
        );
    });

    it("rejects an output directory inside the RP root", () => {
        const cwd = path.join(os.tmpdir(), "bepack-runtime-rp");
        const config = normalizeConfig({
            name: "test",
            root: ".",
            packs: {
                bp: {
                    root: ".",
                    uuid: "a",
                    moduleUuid: "b",
                    compile: {
                        entry: "src/main.ts",
                        scriptOutputDir: "rp/scripts",
                    },
                },
                rp: {
                    root: "rp",
                    uuid: "c",
                    moduleUuid: "d",
                },
            },
        });
        const entry = path.join(cwd, "src", "main.ts");
        const outDir = path.join(cwd, "rp", "scripts");

        expect(() => assertSafeScriptOutputPath(cwd, config, entry, outDir)).toThrow("RP root");
    });

    it.skipIf(process.platform === "win32")("rejects a symbolic link in the output path", () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-symlink-"));
        try {
            const bp = path.join(temp, "bp");
            const external = path.join(temp, "external");
            mkdirSync(bp, { recursive: true });
            mkdirSync(external, { recursive: true });
            symlinkSync(external, path.join(bp, "generated"), "dir");

            const config = normalizeConfig({
                name: "test",
                root: temp,
                packs: {
                    bp: {
                        root: "bp",
                        uuid: "a",
                        moduleUuid: "b",
                        compile: {
                            entry: "src/main.ts",
                            scriptOutputDir: "generated/data",
                        },
                    },
                },
            });
            const entry = path.join(temp, "src", "main.ts");
            const outDir = path.join(bp, "generated", "data");

            expect(() => assertSafeScriptOutputPath(temp, config, entry, outDir)).toThrow(
                "symbolic link"
            );
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it.skipIf(process.platform === "win32")(
        "rejects a BP root symbolic link (symlink bp → real-bp)",
        () => {
            const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-bp-root-link-"));
            try {
                const realBp = path.join(temp, "real-bp");
                const bpLink = path.join(temp, "bp");
                mkdirSync(realBp, { recursive: true });
                symlinkSync(realBp, bpLink, "dir");

                const config = normalizeConfig({
                    name: "test",
                    root: temp,
                    packs: {
                        bp: {
                            root: "bp",
                            uuid: "a",
                            moduleUuid: "b",
                            compile: {
                                entry: "src/main.ts",
                                scriptOutputDir: "scripts",
                            },
                        },
                    },
                });
                const entry = path.join(temp, "src", "main.ts");
                const outDir = path.join(bpLink, "scripts");

                expect(() => assertSafeScriptOutputPath(temp, config, entry, outDir)).toThrow(
                    "symbolic link or junction"
                );
            } finally {
                rmSync(temp, { recursive: true, force: true });
            }
        }
    );

    it.skipIf(process.platform !== "win32")("rejects a BP root junction on Windows", () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-bp-junction-"));
        try {
            const realBp = path.join(temp, "real-bp");
            const bpLink = path.join(temp, "bp");
            mkdirSync(realBp, { recursive: true });
            symlinkSync(realBp, bpLink, "junction");

            const config = normalizeConfig({
                name: "test",
                root: temp,
                packs: {
                    bp: {
                        root: "bp",
                        uuid: "a",
                        moduleUuid: "b",
                        compile: {
                            entry: "src/main.ts",
                            scriptOutputDir: "scripts",
                        },
                    },
                },
            });
            const entry = path.join(temp, "src", "main.ts");
            const outDir = path.join(bpLink, "scripts");

            expect(() => assertSafeScriptOutputPath(temp, config, entry, outDir)).toThrow(
                "symbolic link or junction"
            );
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});

describe("normalizeConfig scriptOutputDir", () => {
    it("does not throw when BP root does not exist yet", () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-no-bp-root-"));
        try {
            const config = normalizeConfig({
                name: "test",
                root: temp,
                packs: {
                    bp: {
                        root: "bp",
                        uuid: "a",
                        moduleUuid: "b",
                        compile: {
                            entry: "src/main.ts",
                            scriptOutputDir: "scripts",
                        },
                    },
                },
            });
            const entry = path.join(temp, "src", "main.ts");
            const outDir = path.join(temp, "bp", "scripts");

            expect(() => assertSafeScriptOutputPath(temp, config, entry, outDir)).not.toThrow();
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("rejects source overlap when BP root equals project root", () => {
        expect(() =>
            normalizeConfig({
                name: "test",
                packs: {
                    bp: {
                        root: ".",
                        uuid: "a",
                        moduleUuid: "b",
                        compile: {
                            entry: "src/main.ts",
                            scriptOutputDir: "src",
                        },
                    },
                },
            })
        ).toThrow("dangerously overlaps");
    });
});
