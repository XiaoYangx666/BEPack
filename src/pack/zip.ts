import { promises as fs } from "node:fs";
import path from "node:path";
import { zipSync } from "fflate";

async function addDir(root: string, dir: string, out: Record<string, Uint8Array>, prefix = ""): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        const name = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) await addDir(root, full, out, name);
        else out[name] = new Uint8Array(await fs.readFile(full));
    }
}

export async function zipDir(source: string, output: string): Promise<void> {
    const files: Record<string, Uint8Array> = {};
    await addDir(source, source, files);
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
