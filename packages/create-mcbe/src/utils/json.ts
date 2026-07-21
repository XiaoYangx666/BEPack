import fs from 'node:fs/promises';

export async function readJson<T>(file: string): Promise<T> {
  const content = await fs.readFile(file, 'utf8');
  return JSON.parse(content) as T;
}

export async function writeJson<T>(file: string, data: T): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

export async function patchJson<T>(file: string, patcher: (json: T) => void | Promise<void>): Promise<T> {
  const json = await readJson<T>(file);
  await patcher(json);
  await writeJson(file, json);
  return json;
}
