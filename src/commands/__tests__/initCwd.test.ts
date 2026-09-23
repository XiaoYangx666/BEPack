import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { commandInit } from "../init.js";

describe("commandInit --cwd", () => {
    it("resolves --from-bp relative to the requested cwd", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-init-"));
        try {
            const bp = path.join(temp, "bp");
            mkdirSync(bp);
            writeFileSync(
                path.join(bp, "manifest.json"),
                JSON.stringify({
                    format_version: 2,
                    header: { name: "BP", uuid: "bp-uuid", version: [1, 0, 0] },
                    modules: [{ type: "data", uuid: "data-uuid", version: [1, 0, 0] }],
                })
            );

            await commandInit({ cwd: temp, fromBp: "bp/manifest.json", format: "ts" });

            expect(existsSync(path.join(temp, "bepack.config.ts"))).toBe(true);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});

function writeScriptManifest(bp: string): void {
    mkdirSync(bp, { recursive: true });
    writeFileSync(
        path.join(bp, "manifest.json"),
        JSON.stringify({
            format_version: 2,
            header: { name: "BP", uuid: "bp-uuid", version: [1, 0, 0] },
            modules: [
                {
                    type: "script",
                    language: "javascript",
                    uuid: "script-uuid",
                    version: [1, 0, 0],
                    entry: "scripts/main.js",
                },
            ],
        })
    );
}

describe("commandInit --dry-run", () => {
    it("does not write the config file", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-init-"));
        try {
            const result = await commandInit({ cwd: temp, dryRun: true, format: "ts" });

            expect(existsSync(path.join(temp, "bepack.config.ts"))).toBe(false);
            expect(result).toMatchObject({ dryRun: true, filesCreated: 0 });
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("does not write the config file when reverse-engineering", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-init-"));
        try {
            writeScriptManifest(path.join(temp, "bp"));

            await commandInit({
                cwd: temp,
                fromBp: "bp/manifest.json",
                format: "ts",
                dryRun: true,
            });

            expect(existsSync(path.join(temp, "bepack.config.ts"))).toBe(false);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("does not create the target directory either", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-init-"));
        try {
            const nested = path.join(temp, "nested", "project");

            await commandInit({ cwd: nested, dryRun: true, format: "ts" });

            expect(existsSync(nested)).toBe(false);
            expect(existsSync(temp)).toBe(true);
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});

describe("commandInit --from-bp compile detection", () => {
    async function generatedConfig(temp: string): Promise<string> {
        await commandInit({ cwd: temp, fromBp: "bp/manifest.json", format: "mjs" });
        return readFileSync(path.join(temp, "bepack.config.mjs"), "utf8");
    }

    it("leaves compile unset when the scripts already live inside the pack", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-init-"));
        try {
            writeScriptManifest(path.join(temp, "bp"));
            mkdirSync(path.join(temp, "bp", "scripts"));
            writeFileSync(path.join(temp, "bp", "scripts", "main.js"), "console.warn(1);");

            const config = await generatedConfig(temp);

            // No src/ and no tsconfig.json: a generated compile.entry would fail the
            // first `bepack build`, so compilation stays disabled.
            expect(config).not.toContain("compile");
            expect(config).toContain("moduleUuid");
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("enables compile with typecheck when sources and tsconfig exist", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-init-"));
        try {
            writeScriptManifest(path.join(temp, "bp"));
            mkdirSync(path.join(temp, "src"));
            writeFileSync(path.join(temp, "src", "main.ts"), "console.warn(1);");
            writeFileSync(path.join(temp, "tsconfig.json"), "{}");

            const config = await generatedConfig(temp);

            expect(config).toContain('entry: "src/main.ts"');
            expect(config).toContain('scriptOutputDir: "scripts"');
            expect(config).not.toContain("typecheck: false");
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });

    it("disables typecheck when the source exists without a tsconfig.json", async () => {
        const temp = mkdtempSync(path.join(os.tmpdir(), "bepack-init-"));
        try {
            writeScriptManifest(path.join(temp, "bp"));
            mkdirSync(path.join(temp, "src"));
            writeFileSync(path.join(temp, "src", "main.ts"), "console.warn(1);");

            const config = await generatedConfig(temp);

            expect(config).toContain('entry: "src/main.ts"');
            expect(config).toContain("typecheck: false");
        } finally {
            rmSync(temp, { recursive: true, force: true });
        }
    });
});
