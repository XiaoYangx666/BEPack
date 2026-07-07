import path from "node:path";
import { zipDir } from "./zip.js";

export async function packMcpack(
    source: string,
    dist: string,
    name: string,
    dryRun = false
): Promise<string> {
    const output = path.join(dist, `${name}.mcpack`);
    if (!dryRun) await zipDir(source, output);
    return output;
}
