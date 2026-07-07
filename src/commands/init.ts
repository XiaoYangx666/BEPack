import path from "node:path";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { ensureDir, pathExists } from "../utils/fs.js";
import { BePackError } from "../errors/BePackError.js";

async function writeIfAllowed(file: string, content: string, force: boolean): Promise<boolean> {
    if (!force && (await pathExists(file))) return false;
    await ensureDir(path.dirname(file));
    await fs.writeFile(file, content, "utf8");
    return true;
}

export async function commandInit(options: any) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const format = options.format ?? "ts";
    if (!["ts", "js", "mjs"].includes(format)) throw new BePackError("CONFIG_INVALID", "init --format must be ts, js, or mjs.");
    const configFile = path.join(cwd, `bepack.config.${format}`);
    const config = `export default {
    root: ".",
    name: "example-addon",
    version: "1.0.0",
    target: "latest",
    build: {
        entry: "src/main.ts",
    },
    packs: {
        bp: {
            root: "bp",
            uuid: "${randomUUID()}",
            moduleUuid: "${randomUUID()}",
            dependencies: {
                "@minecraft/server": "stable",
            },
        },
    },
    pack: {
        outDir: "dist",
    },
};
`;
    const files = [await writeIfAllowed(configFile, config, Boolean(options.force))];
    return { ok: true, command: "init", filesCreated: files.filter(Boolean).length };
}
