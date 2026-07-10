import { promises as fs } from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";

async function addDir(
    root: string,
    dir: string,
    out: Record<string, Uint8Array>,
    prefix = ""
): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await addDir(root, full, out, name);
        else out[name] = new Uint8Array(await fs.readFile(full));
    }
}

async function addItem(
    source: string,
    item: string,
    out: Record<string, Uint8Array>
): Promise<void> {
    const full = path.join(source, item);
    try {
        const stat = await fs.stat(full);
        if (stat.isDirectory()) {
            await addDir(source, full, out, item);
        } else {
            out[item] = new Uint8Array(await fs.readFile(full));
        }
    } catch {
        // skip missing items
    }
}

export async function zipDir(source: string, output: string): Promise<void> {
    const files: Record<string, Uint8Array> = {};
    await addDir(source, source, files);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, zipSync(files));
}

/**
 * Zip only specific items from a source directory.
 * Missing items are silently skipped.
 */
export async function zipSelectedItems(
    source: string,
    items: string[],
    output: string
): Promise<void> {
    const files: Record<string, Uint8Array> = {};
    for (const item of items) {
        await addItem(source, item, files);
    }
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, zipSync(files));
}

export async function zipAddon(packs: { dir: string }[], output: string): Promise<void> {
    const files: Record<string, Uint8Array> = {};
    for (const pack of packs) {
        await addDir(pack.dir, pack.dir, files, path.basename(path.resolve(pack.dir)));
    }
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, zipSync(files));
}

export async function zipAddonSelected(
    packs: { source: string; items: string[] }[],
    output: string
): Promise<void> {
    const files: Record<string, Uint8Array> = {};
    for (const pack of packs) {
        const prefix = path.basename(path.resolve(pack.source));
        for (const item of pack.items) {
            const full = path.join(pack.source, item);
            try {
                const stat = await fs.stat(full);
                if (stat.isDirectory()) {
                    await addDir(pack.source, full, files, `${prefix}/${item}`);
                } else {
                    files[`${prefix}/${item}`] = new Uint8Array(await fs.readFile(full));
                }
            } catch {
                // skip missing items
            }
        }
    }
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, zipSync(files));
}

/**
 * Hybrid: selective items from some packs + full directories from others -> mcaddon zip.
 * Used when BP is selective (always) but RP may be a full directory.
 */
export async function zipAddonHybrid(
    selectivePacks: { source: string; items: string[] }[],
    fullPacks: { dir: string }[],
    output: string
): Promise<void> {
    const files: Record<string, Uint8Array> = {};
    for (const pack of selectivePacks) {
        const prefix = path.basename(path.resolve(pack.source));
        for (const item of pack.items) {
            const full = path.join(pack.source, item);
            try {
                const stat = await fs.stat(full);
                if (stat.isDirectory()) {
                    await addDir(pack.source, full, files, `${prefix}/${item}`);
                } else {
                    files[`${prefix}/${item}`] = new Uint8Array(await fs.readFile(full));
                }
            } catch {
                // skip missing items
            }
        }
    }
    for (const pack of fullPacks) {
        await addDir(pack.dir, pack.dir, files, path.basename(path.resolve(pack.dir)));
    }
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, zipSync(files));
}
