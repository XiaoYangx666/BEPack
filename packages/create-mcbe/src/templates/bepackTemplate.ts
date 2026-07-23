import type { TemplateDefinition } from '../types.js';
import { prepareBepack, type BepackPrepareOptions } from './prepare.js';

export interface BepackTemplateDefinition extends BepackPrepareOptions {
  id: string;
  title: string;
  description: string;
  templateDir: string;
  skills?: string | string[];
}

export function createBepackTemplate(definition: BepackTemplateDefinition): TemplateDefinition {
  const { id, title, description, templateDir, skills, ...prepareOptions } = definition;
  return {
    id,
    title,
    description,
    templateDir,
    defaultPackageManager: 'npm',
    skills,
    workflow: 'bepack',
    prepare: (ctx) => prepareBepack(ctx, prepareOptions),
  };
}
