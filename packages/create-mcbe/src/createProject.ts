import fs from 'node:fs/promises';
import path from 'node:path';
import * as p from '@clack/prompts';
import { copyTemplateDir, emptyDir, isEmptyDir, pathExists } from './utils/files.js';
import { initGit, installDependencies, installSkills, packageManagerRunCommand, run, skillsInstallCommand } from './utils/packageManager.js';
import { toPackageName } from './utils/names.js';
import { templates } from './templates/index.js';
import { setPackageIdentity } from './utils/packageJson.js';
import type { CliOptions, CreateContext, CreateResult, TemplateDefinition } from './types.js';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function createProject(cli: CliOptions): Promise<CreateResult> {
  const projectName = await resolveProjectName(cli);
  validateProjectName(projectName);
  const template = await resolveTemplate(cli);
  const installBepack = await resolveBepackInstallation(cli, template);
  const root = path.resolve(cli.cwd, projectName);
  const packageManager = cli.packageManager || template.defaultPackageManager || 'npm';
  const ctx: CreateContext = {
    cli, cwd: cli.cwd, root, projectName, packageName: toPackageName(projectName), template,
    packageManager, installBepack, templateOptions: template.defaultOptions ?? {},
  };

  await prepareTargetDir(ctx);
  await copyTemplateDir(path.resolve(packageRoot, 'templates', template.templateDir), root);
  if (await pathExists(path.join(root, 'package.json'))) {
    await setPackageIdentity(root, { name: ctx.packageName, packageManager });
    if (template.workflow === 'bepack' && !installBepack) await removeBepackDependency(root);
  }
  await template.prepare?.(ctx);

  let initializedGit = false;
  if (cli.git) { await initGit(root); initializedGit = true; }
  let installedDependencies = false;
  let installedSkills = false;
  if (cli.install) {
    if (await pathExists(path.join(root, 'package.json'))) {
      if (template.workflow === 'bepack' && installBepack) {
        await installDependencies(packageManager, root);
        await runPackageScript(packageManager, 'bepack:install', root);
      } else if (template.workflow === 'bepack') {
        await run('bepack', ['install'], root);
      } else await installDependencies(packageManager, root);
      installedDependencies = true;
    }
    const skills = normalizeSkills(template.skills);
    if (!cli.skipSkillsInstall && skills.length > 0) {
      await installSkills(skills, root);
      installedSkills = true;
    }
  }

  return {
    root, projectName, template: template.id, packageManager, installedDependencies,
    installedSkills, initializedGit, warnings: [], nextSteps: nextSteps(ctx, installedDependencies, installedSkills || cli.skipSkillsInstall),
  };
}

async function resolveProjectName(cli: CliOptions): Promise<string> {
  if (cli.projectName) return cli.projectName;
  if (cli.yes || !process.stdin.isTTY) return 'mcbe-addon';
  const answer = await p.text({
    message: 'Project name',
    placeholder: 'my-addon',
    defaultValue: 'my-addon',
    validate(value) {
      if (!value?.trim()) return 'Project name is required.';
      return undefined;
    },
  });
  if (p.isCancel(answer)) throw answer;
  return String(answer);
}

async function resolveTemplate(cli: CliOptions): Promise<TemplateDefinition> {
  if (cli.template) {
    const template = templates.find((candidate) => candidate.id === cli.template);
    if (!template) throw new Error(`Unknown template "${cli.template}". Available: ${templates.map((t) => t.id).join(', ')}`);
    return template;
  }
  if (cli.yes || !process.stdin.isTTY) return templates[0]!;
  const answer = await p.select({
    message: 'Select a template',
    options: templates.map((template) => ({
      value: template.id,
      label: template.title,
      hint: template.description,
    })),
  });
  if (p.isCancel(answer)) throw answer;
  return templates.find((template) => template.id === String(answer))!;
}

async function resolveBepackInstallation(cli: CliOptions, template: TemplateDefinition): Promise<boolean> {
  if (template.workflow !== 'bepack') return false;
  if (cli.installBepack !== undefined) return cli.installBepack;
  if (cli.yes || !process.stdin.isTTY) return true;
  const answer = await p.confirm({
    message: 'Install BEPack in this project?',
    initialValue: true,
  });
  if (p.isCancel(answer)) throw answer;
  return Boolean(answer);
}

function validateProjectName(name: string): void {
  if (!name.trim() || name === '.' || name === '..' || path.isAbsolute(name)) {
    throw new Error('Project name must be a non-empty relative child directory, not . or an absolute path.');
  }
  const normalized = path.normalize(name);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`)) {
    throw new Error('Project name cannot escape the working directory.');
  }
}

async function prepareTargetDir(ctx: CreateContext): Promise<void> {
  if (!(await pathExists(ctx.root))) { await fs.mkdir(ctx.root, { recursive: true }); return; }
  if (await isEmptyDir(ctx.root)) return;
  if (ctx.cli.force) { await emptyDir(ctx.root); return; }
  if (ctx.cli.yes || !process.stdin.isTTY) throw new Error(`Target directory is not empty: ${ctx.root}. Use --force to overwrite.`);
  const action = await p.select({
    message: `Target directory ${ctx.projectName} is not empty`,
    options: [{ value: 'cancel', label: 'Cancel' }, { value: 'overwrite', label: 'Overwrite' }],
  });
  if (p.isCancel(action) || action === 'cancel') throw new Error('Cancelled.');
  await emptyDir(ctx.root);
}

function nextSteps(ctx: CreateContext, installed: boolean, skillsInstalled: boolean): string[] {
  const steps = [`cd ${path.relative(process.cwd(), ctx.root) || '.'}`];
  if (ctx.template.workflow === 'bepack') {
    if (ctx.installBepack && !installed) {
      steps.push(`${ctx.packageManager} install`);
      steps.push(packageManagerRunCommand(ctx.packageManager, 'bepack:install'));
    } else if (!ctx.installBepack) {
      steps.push('bepack install');
    }
    steps.push(packageManagerRunCommand(ctx.packageManager, 'build'));
  }
  if (!skillsInstalled) {
    const skills = normalizeSkills(ctx.template.skills);
    if (skills.length > 0) steps.push(skillsInstallCommand(skills));
  }
  return steps;
}

function normalizeSkills(skills: TemplateDefinition['skills']): string[] {
  return (Array.isArray(skills) ? skills : skills ? [skills] : []).map((source) => source.trim()).filter(Boolean);
}

async function runPackageScript(pm: CreateContext['packageManager'], script: string, root: string): Promise<void> {
  if (pm === 'npm') return run('npm', ['run', script], root);
  if (pm === 'pnpm') return run('pnpm', [script], root);
  if (pm === 'yarn') return run('yarn', [script], root);
  return run('bun', ['run', script], root);
}

async function removeBepackDependency(root: string): Promise<void> {
  const file = path.join(root, 'package.json');
  const packageJson = JSON.parse(await fs.readFile(file, 'utf8')) as { devDependencies?: Record<string, string>; scripts?: Record<string, string> };
  if (packageJson.devDependencies) delete packageJson.devDependencies['@bepack/cli'];
  if (packageJson.scripts) delete packageJson.scripts['bepack:install'];
  await fs.writeFile(file, `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
}
