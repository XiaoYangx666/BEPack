import type { TemplateDefinition } from '../types.js';
import { createBepackTemplate } from './bepackTemplate.js';
import { preparePackIdentity } from './prepare.js';

export const templates: TemplateDefinition[] = [
  createBepackTemplate({
    id: 'sapi-pro',
    title: 'SAPI-Pro + BEPack',
    description: 'SAPI-Pro behavior pack managed and packed by BEPack.',
    templateDir: 'sapi-pro',
    bpRoot: '.',
    dependencies: {
      '@minecraft/server': 'stable',
      '@minecraft/server-ui': 'stable',
      '@minecraft/vanilla-data': 'stable',
      'sapi-pro': 'stable',
    },
    plugin: { name: 'sapi-pro', importName: 'sapiPro', call: 'sapiPro()' },
    replaceBuiltins: true,
    nameFromPackage: true,
  }),
  createBepackTemplate({
    id: 'bepack-behavior',
    title: 'BEPack Behavior Pack',
    description: 'TypeScript Script API behavior pack built and packed by BEPack.',
    templateDir: 'bepack-behavior',
    bpRoot: '.',
  }),
  createBepackTemplate({
    id: 'bepack-addon',
    title: 'BEPack Add-on (BP + RP)',
    description: 'TypeScript behavior pack plus resource pack, managed by BEPack.',
    templateDir: 'bepack-addon',
    bpRoot: 'bp',
    rpRoot: 'rp',
  }),
  {
    id: 'behavior-pack',
    title: 'Behavior Pack',
    description: 'Simple behavior pack without scripts or build tools.',
    templateDir: 'behavior-pack',
    prepare: preparePackIdentity,
  },
  {
    id: 'resource-pack',
    title: 'Resource Pack',
    description: 'Simple resource pack without scripts or build tools.',
    templateDir: 'resource-pack',
    prepare: preparePackIdentity,
  },
];
