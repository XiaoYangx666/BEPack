import { spawn } from 'node:child_process';

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun';

export function detectPackageManager(): PackageManager {
  const ua = process.env.npm_config_user_agent || '';
  if (ua.startsWith('pnpm')) return 'pnpm';
  if (ua.startsWith('yarn')) return 'yarn';
  if (ua.startsWith('bun')) return 'bun';
  return 'npm';
}

export function packageManagerField(pm: PackageManager): string {
  const versions: Record<PackageManager, string> = {
    npm: 'npm@10',
    pnpm: 'pnpm@9',
    yarn: 'yarn@1.22',
    bun: 'bun@1',
  };
  return versions[pm]!;
}

export function packageManagerRunCommand(pm: PackageManager, script: string): string {
  if (pm === 'npm') return `npm run ${script}`;
  if (pm === 'yarn') return `yarn ${script}`;
  if (pm === 'bun') return `bun run ${script}`;
  return `pnpm ${script}`;
}

export async function installDependencies(pm: PackageManager, cwd: string): Promise<void> {
  const command = pm;
  const args = pm === 'yarn' ? [] : ['install'];
  await run(command, args, cwd);
}

export async function initGit(cwd: string): Promise<void> {
  await run('git', ['init'], cwd);
}

export function run(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'ignore',
      shell: process.platform === 'win32',
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} failed with code ${code}`));
    });
  });
}
