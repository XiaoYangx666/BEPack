import path from 'node:path';
import mri from 'mri';
import type { CliOptions } from './types.js';
import { detectPackageManager, type PackageManager } from './utils/packageManager.js';

const managers = new Set<PackageManager>(['npm', 'pnpm', 'yarn', 'bun']);

export function parseCliOptions(argv: string[] = []): CliOptions {
  const raw = mri(argv, {
    alias: { h: 'help', v: 'version', t: 'template' },
    boolean: ['help', 'version', 'yes', 'force', 'install', 'skip-skills-install', 'install-bepack', 'skip-bepack-install', 'git', 'json', 'list-templates'],
    string: ['template', 'pm', 'cwd'],
    default: { install: false, git: false },
  }) as Record<string, unknown>;
  const pm = String(raw.pm || detectPackageManager()) as PackageManager;
  if (!managers.has(pm)) throw new Error(`Unknown package manager: ${pm}`);
  const projectName = Array.isArray(raw._) ? raw._.find(Boolean) : undefined;
  return {
    cwd: path.resolve(String(raw.cwd || process.cwd())),
    projectName: projectName === undefined ? undefined : String(projectName),
    template: raw.template ? String(raw.template) : undefined,
    packageManager: pm, yes: Boolean(raw.yes), force: Boolean(raw.force),
    install: Boolean(raw.install),
    skipSkillsInstall: Boolean(raw['skip-skills-install']),
    installBepack: raw['skip-bepack-install'] ? false : raw['install-bepack'] ? true : undefined,
    git: Boolean(raw.git), json: Boolean(raw.json),
    listTemplates: Boolean(raw['list-templates']), help: Boolean(raw.help), version: Boolean(raw.version),
  };
}
