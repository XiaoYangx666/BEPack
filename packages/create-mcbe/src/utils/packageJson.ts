import path from 'node:path';
import type { PackageManager } from './packageManager.js';
import { patchJson, readJson } from './json.js';
import { packageManagerField } from './packageManager.js';

export type DependencyKind = 'dependencies' | 'devDependencies' | 'peerDependencies' | 'optionalDependencies';

export interface PackageJson {
  name?: string;
  version?: string;
  type?: string;
  private?: boolean;
  packageManager?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

export function packageJsonPath(root: string): string {
  return path.join(root, 'package.json');
}

export function readPackageJson(root: string): Promise<PackageJson> {
  return readJson<PackageJson>(packageJsonPath(root));
}

export async function patchPackageJson(root: string, patcher: (json: PackageJson) => void | Promise<void>): Promise<PackageJson> {
  return patchJson<PackageJson>(packageJsonPath(root), patcher);
}

export async function setPackageIdentity(
  root: string,
  options: { name: string; packageManager?: PackageManager },
): Promise<PackageJson> {
  return patchPackageJson(root, (json) => {
    json.name = options.name;
    if (options.packageManager) json.packageManager = packageManagerField(options.packageManager);
  });
}

export async function setDependency(
  root: string,
  name: string,
  version: string,
  kind: DependencyKind = 'dependencies',
): Promise<PackageJson> {
  return patchPackageJson(root, (json) => {
    json[kind] ??= {};
    json[kind]![name] = version;
  });
}
