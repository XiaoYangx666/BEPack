import fs from 'node:fs/promises';
import path from 'node:path';

export async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function isEmptyDir(dir: string): Promise<boolean> {
  if (!(await pathExists(dir))) return true;
  const entries = await fs.readdir(dir);
  return entries.length === 0 || entries.every((entry) => entry === '.git');
}

export async function emptyDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const entries = await fs.readdir(dir);
  await Promise.all(
    entries.map(async (entry) => {
      if (entry === '.git') return;
      await fs.rm(path.join(dir, entry), { recursive: true, force: true });
    }),
  );
}

export async function copyTemplateDir(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  const entries = await fs.readdir(from, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name === '.DS_Store') continue;

    const source = path.join(from, entry.name);
    const target = path.join(to, normalizeTemplateFileName(entry.name));

    if (entry.isDirectory()) {
      await copyTemplateDir(source, target);
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.copyFile(source, target);
    } else if (entry.isSymbolicLink()) {
      const link = await fs.readlink(source);
      await fs.symlink(link, target);
    }
  }
}

export function normalizeTemplateFileName(name: string): string {
  if (name === '_gitignore') return '.gitignore';
  if (name === '_npmrc') return '.npmrc';
  return name;
}
