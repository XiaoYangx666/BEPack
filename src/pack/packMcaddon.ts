import path from "node:path";
import { zipAddon } from "./zip.js";

export async function packMcaddon(
    packs: { dir: string }[],
    dist: string,
    name: string,
    dryRun = false
): Promise<string> {
    const output = path.join(dist, `${name}.mcaddon`);
    if (!dryRun) await zipAddon(packs, output);
    return output;
}
