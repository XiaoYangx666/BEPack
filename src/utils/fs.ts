import { promises as fs } from "node:fs";
import path from "node:path";
import { parseJson, stringifyJson } from "./json.js";

export async function pathExists(file: string): Promise<boolean> {
    try {
        await fs.access(file);
        return true;
    } catch {
        return false;
    }
}

export async function ensureDir(dir: string): Promise<void> {
    await fs.mkdir(dir, { recursive: true });
}

export async function emptyDir(dir: string): Promise<void> {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.mkdir(dir, { recursive: true });
}

export async function readJsonFile<T>(file: string): Promise<T> {
    return parseJson<T>(await fs.readFile(file, "utf8"), file);
}

export async function writeJsonFile(file: string, value: unknown): Promise<void> {
    await ensureDir(path.dirname(file));
    await fs.writeFile(file, stringifyJson(value), "utf8");
}

export async function copyDir(source: string, target: string): Promise<void> {
    await fs.rm(target, { recursive: true, force: true });
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.cp(source, target, { recursive: true });
}
