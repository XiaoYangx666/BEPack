import path from "node:path";
import { zipDir } from "./zip.js";
import type { FilesTransform } from "./zip.js";

export async function packMcpack(
    source: string,
    dist: string,
    name: string,
    dryRun = false,
    transform?: FilesTransform
): Promise<string> {
    const output = path.join(dist, `${name}.mcpack`);
    if (!dryRun) await zipDir(source, output, transform);
    return output;
}
