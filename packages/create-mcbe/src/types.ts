import type { PackageManager } from './utils/packageManager.js';
export type { PackageManager } from './utils/packageManager.js';

export interface CliOptions {
  cwd: string;
  projectName?: string;
  template?: string;
  packageManager: PackageManager;
  yes: boolean;
  force: boolean;
  install: boolean;
  skipSkillsInstall: boolean;
  installBepack?: boolean;
  git: boolean;
  json: boolean;
  listTemplates: boolean;
  help: boolean;
  version: boolean;
}

export interface CreateContext {
  cli: CliOptions;
  cwd: string;
  root: string;
  projectName: string;
  packageName: string;
  template: TemplateDefinition;
  packageManager: PackageManager;
  installBepack: boolean;
  templateOptions: Record<string, unknown>;
}

export interface TemplateDefinition {
  id: string;
  title: string;
  description: string;
  templateDir: string;
  defaultPackageManager?: PackageManager;
  defaultOptions?: Record<string, unknown>;
  skills?: string | string[];
  workflow?: 'bepack' | 'simple';
  prepare?: (ctx: CreateContext) => Promise<void> | void;
}

export interface CreateResult {
  root: string;
  projectName: string;
  template: string;
  packageManager: PackageManager;
  installedDependencies: boolean;
  installedSkills: boolean;
  initializedGit: boolean;
  warnings: string[];
  nextSteps: string[];
}
