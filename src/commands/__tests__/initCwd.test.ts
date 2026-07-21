import { describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
