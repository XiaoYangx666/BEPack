import { describe, it, expect } from "vitest";
import path from "node:path";
import os from "node:os";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { normalizeConfig } from "../../config/normalizeConfig.js";
import { assertSafeScriptOutputPath } from "../../build/runRolldown.js";

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

describe("runtime script output validation", () => {
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
});
