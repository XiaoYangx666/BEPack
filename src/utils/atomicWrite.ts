import { promises as fs } from "node:fs";
import path from "node:path";

export async function atomicWrite(file: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, content, "utf8");
    await fs.rename(tmp, file);
}
