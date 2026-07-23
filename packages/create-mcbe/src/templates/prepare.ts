import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { CreateContext } from '../types.js';
import { pathExists } from '../utils/files.js';
import { patchJson } from '../utils/json.js';

type Manifest = { header: Record<string, any>; modules?: Array<Record<string, any>> };

export async function preparePackIdentity(ctx: CreateContext): Promise<void> {
  const candidates = [
    [path.join(ctx.root, 'bp', 'manifest.json'), 'BP'],
    [path.join(ctx.root, 'rp', 'manifest.json'), 'RP'],
    [path.join(ctx.root, 'manifest.json'), ctx.template.id === 'resource-pack' ? 'RP' : 'BP'],
  ] as const;
  for (const [file, suffix] of candidates) {
    if (!(await pathExists(file))) continue;
    await patchJson<Manifest>(file, (manifest) => {
      manifest.header.name = `${ctx.projectName} ${suffix}`;
      manifest.header.description = `${ctx.projectName} ${suffix.toLowerCase()}`;
      manifest.header.uuid = crypto.randomUUID();
      for (const module of manifest.modules ?? []) module.uuid = crypto.randomUUID();
    });
  }
}

export interface BepackPrepareOptions {
  bpRoot: string;
  rpRoot?: string;
  dependencies?: Record<string, string>;
  plugin?: { name: string; importName: string; call: string };
  replaceBuiltins?: boolean;
  nameFromPackage?: boolean;
}

export async function prepareBepack(ctx: CreateContext, options: BepackPrepareOptions): Promise<void> {
  await preparePackIdentity(ctx);
  const bpManifest = JSON.parse(await fs.readFile(path.join(ctx.root, options.bpRoot, 'manifest.json'), 'utf8')) as Manifest;
  const rpManifest = options.rpRoot
    ? JSON.parse(await fs.readFile(path.join(ctx.root, options.rpRoot, 'manifest.json'), 'utf8')) as Manifest
    : undefined;
  const bpModule = bpManifest.modules?.find((module) => module.type === 'script');
  const config = {
    name: options.nameFromPackage ? ctx.packageName : ctx.projectName,
    version: '1.0.0',
    description: `${ctx.projectName} Bedrock add-on`,
    target: 'latest',
    packs: {
      bp: {
        root: options.bpRoot,
        uuid: bpManifest.header.uuid,
        ...(bpModule?.uuid ? { moduleUuid: bpModule.uuid } : {}),
        compile: { entry: 'src/main.ts' },
        dependencies: options.dependencies ?? { '@minecraft/server': 'stable' },
      },
      ...(rpManifest ? {
        rp: { root: options.rpRoot, uuid: rpManifest.header.uuid, moduleUuid: rpManifest.modules?.[0]?.uuid },
      } : {}),
    },
    pack: { outDir: 'dist' },
    ...(options.replaceBuiltins ? {
      replace: { builtins: { NAME: true, DESCRIPTION: true, VERSION: true, UUID: true } },
    } : {}),
  };
  await fs.writeFile(
    path.join(ctx.root, 'bepack.config.ts'),
    formatConfig(config, options.plugin, ctx.installBepack),
    'utf8',
  );
}

function formatConfig(config: Record<string, unknown>, plugin: BepackPrepareOptions['plugin'], withBepack: boolean): string {
  const json = JSON.stringify(config, null, 2);
  const unquoted = json.replace(/\n( +)"([a-zA-Z_$][a-zA-Z0-9_$]*)": /g, '\n$1$2: ');
  const body = plugin
    ? unquoted.replace(/^\{\n/, withBepack
      ? `{\n  plugins: [${plugin.call}],\n`
      : `{\n  plugins: ['${plugin.name}'],\n`)
    : unquoted;
  const imports = withBepack && plugin
    ? `import { defineConfig, ${plugin.importName} } from '@bepack/cli';`
    : withBepack ? "import { defineConfig } from '@bepack/cli';" : '';
  const expression = withBepack ? `defineConfig(${body})` : body;
  return `${imports ? `${imports}\n\n` : ''}export default ${expression};\n`;
}
