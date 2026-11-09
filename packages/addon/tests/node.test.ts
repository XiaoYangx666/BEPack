import { access, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AddonError, readAddon } from "../src/index.js";
import {
    readAddonArchiveFile,
    readAddonFile,
    writeAddonArchiveFile,
    writeAddonFile,
} from "../src/node.js";
import { encode, makeAddon, makeManifest } from "./helpers.js";

const tempDirectories: string[] = [];

async function tempDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "bepack-addon-"));
    tempDirectories.push(directory);
    return directory;
}

async function exists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

afterEach(async () => {
    await Promise.all(
        tempDirectories
            .splice(0)
            .map((directory) => rm(directory, { recursive: true, force: true }))
    );
});

describe("readAddonFile", () => {
    it("reads a template and uses its file name as sourceName", async () => {
        const directory = await tempDirectory();
        const source = join(directory, "template.mcaddon");
        await writeFile(source, makeAddon());

        const addon = await readAddonFile(source);
        expect(addon.sourceName).toBe("template.mcaddon");
        expect(addon.packs.bp?.manifestPath).toBe("bp/manifest.json");
        expect(addon.fileCount).toBe(4);
    });

    it("allows an explicit sourceName", async () => {
        const directory = await tempDirectory();
        const source = join(directory, "template.mcaddon");
        await writeFile(source, makeAddon());

        const addon = await readAddonFile(source, { sourceName: "custom.mcaddon" });
        expect(addon.sourceName).toBe("custom.mcaddon");
    });

    it("reads raw archive entries", async () => {
        const directory = await tempDirectory();
        const source = join(directory, "pack.mcpack");
        await writeFile(source, makeAddon());

        const files = await readAddonArchiveFile(source);
        expect(files.map((file) => file.path)).toContain("bp/manifest.json");
    });
});

describe("writeAddonFile", () => {
    it("writes an edited addon and creates parent directories", async () => {
        const directory = await tempDirectory();
        const source = join(directory, "template.mcaddon");
        await writeFile(source, makeAddon());

        const addon = await readAddonFile(source);
        addon.updateIdentity({ name: "Written", version: [2, 0, 0] });
        const target = join(directory, "nested", "deeper", "out.mcaddon");

        const result = await writeAddonFile(target, addon);
        expect(result.path).toBe(target);
        expect(result.bytes).toBeGreaterThan(0);

        const reopened = await readAddonFile(target);
        expect(reopened.identity().name).toBe("Written");
        expect(reopened.identity().version).toEqual([2, 0, 0]);
    });

    it("leaves no temporary files behind", async () => {
        const directory = await tempDirectory();
        const target = join(directory, "out.mcaddon");

        await writeFile(join(directory, "source.mcaddon"), makeAddon());
        const entries = await readAddonArchiveFile(join(directory, "source.mcaddon"));
        await writeAddonArchiveFile(target, entries);

        const names = await readdir(directory);
        expect(names.filter((name) => name.endsWith(".tmp"))).toEqual([]);
        expect(names).toContain("out.mcaddon");
    });

    it("does not leave a partial file when writing fails", async () => {
        const directory = await tempDirectory();
        const target = join(directory, "broken.mcaddon");

        await expect(
            writeAddonArchiveFile(target, [
                { path: "bp/manifest.json", bytes: encode(makeManifest("bp")) },
                { path: "bp/manifest.json", bytes: encode(makeManifest("bp")) },
            ])
        ).rejects.toBeInstanceOf(AddonError);

        expect(await exists(target)).toBe(false);
        expect((await readdir(directory)).filter((name) => name.includes("broken"))).toEqual([]);
    });

    it("writes over an existing file", async () => {
        const directory = await tempDirectory();
        const target = join(directory, "out.mcaddon");
        await writeFile(target, new Uint8Array([0, 1, 2]));

        const addon = await readAddon(makeAddon());
        await writeAddonFile(target, addon);

        const reopened = await readAddonFile(target);
        expect(reopened.packs.bp?.manifest.header?.name).toBe("Test BP");
    });

    it("reports progress", async () => {
        const directory = await tempDirectory();
        const addon = await readAddon(makeAddon());
        const progress: number[] = [];

        await writeAddonFile(join(directory, "out.mcaddon"), addon, {
            onProgress(processed) {
                progress.push(processed);
            },
        });

        expect(progress.length).toBeGreaterThan(1);
        expect(progress.at(-1)).toBe(addon.totalBytes);
    });

    it("fails when the parent directory is missing and mkdir is disabled", async () => {
        const directory = await tempDirectory();
        const addon = await readAddon(makeAddon());

        await expect(
            writeAddonFile(join(directory, "missing", "out.mcaddon"), addon, { mkdir: false })
        ).rejects.toBeTruthy();
    });
});
