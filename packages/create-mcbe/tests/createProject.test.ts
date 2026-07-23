import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '../src/createProject.js';
import { parseCliOptions } from '../src/parseCliOptions.js';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });
async function temp(): Promise<string> { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-mcbe-')); roots.push(root); return root; }

describe('createProject', () => {
  it('creates a BEPack BP+RP project and configures package identity', async () => {
    const cwd = await temp();
    const result = await createProject(parseCliOptions(['demo', '--template', 'bepack-addon', '--yes', '--cwd', cwd]));
    expect(result.template).toBe('bepack-addon');
    const config = await fs.readFile(path.join(cwd, 'demo', 'bepack.config.ts'), 'utf8');
    expect(config).toContain('root: "bp"');
    expect(config).toContain('root: "rp"');
    expect(config).toContain('name: "demo"');
    expect(config).toContain('"@minecraft/server": "stable"');
    const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'demo', 'package.json'), 'utf8'));
    expect(pkg.name).toBe('demo');
    expect(pkg.devDependencies['@bepack/cli']).toBeDefined();
  });

  it('uses the project root as the BEPack BP root', async () => {
    const cwd = await temp();
    await createProject(parseCliOptions(['demo', '--template', 'bepack-behavior', '--yes', '--cwd', cwd]));
    const root = path.join(cwd, 'demo');
    const config = await fs.readFile(path.join(root, 'bepack.config.ts'), 'utf8');
    expect(config).toContain('root: "."');
    await expect(fs.access(path.join(root, 'manifest.json'))).resolves.toBeUndefined();
    await expect(fs.access(path.join(root, 'bp'))).rejects.toThrow();
  });

  it('creates the SAPI-Pro template with the BEPack plugin and replacements', async () => {
    const cwd = await temp();
    await createProject(parseCliOptions(['Fancy Addon', '--template', 'sapi-pro', '--yes', '--cwd', cwd]));
    const root = path.join(cwd, 'Fancy Addon');
    const config = await fs.readFile(path.join(root, 'bepack.config.ts'), 'utf8');
    const source = await fs.readFile(path.join(root, 'src', 'main.ts'), 'utf8');
    expect(config).toContain("import { defineConfig, sapiPro } from '@bepack/cli';");
    expect(config).toContain('plugins: [sapiPro()]');
    expect(config).toContain('"sapi-pro": "stable"');
    expect(config).toContain('replace:');
    expect(source).toContain("from 'sapi-pro'");
    expect(source).toContain('**NAME**');
    expect(source).toContain("nameSpace: 'example_addon'");
    expect(source).toContain("author: 'Your Name'");
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.name).toBe('fancy-addon');
    expect(config).toContain('name: "fancy-addon"');
  });

  it('keeps the SAPI-Pro plugin declarative when BEPack is not installed locally', async () => {
    const cwd = await temp();
    await createProject(parseCliOptions(['demo', '--template', 'sapi-pro', '--skip-bepack-install', '--yes', '--cwd', cwd]));
    const root = path.join(cwd, 'demo');
    const config = await fs.readFile(path.join(root, 'bepack.config.ts'), 'utf8');
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    expect(config).toContain("plugins: ['sapi-pro']");
  expect(config).not.toContain("from '@bepack/cli'");
  expect(pkg.devDependencies?.['@bepack/cli']).toBeUndefined();
  });

  it('rejects dangerous project names', async () => {
    const cwd = await temp();
    await expect(createProject(parseCliOptions(['.', '--template', 'behavior-pack', '--force', '--cwd', cwd]))).rejects.toThrow('relative child directory');
  });
});
