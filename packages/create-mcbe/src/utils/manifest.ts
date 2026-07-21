import crypto from 'node:crypto';
import path from 'node:path';
import { patchJson, readJson } from './json.js';

export type VersionTuple = [number, number, number];

export interface ManifestHeader {
  name: string;
  description?: string;
  uuid: string;
  version: VersionTuple;
  min_engine_version?: VersionTuple;
  [key: string]: unknown;
}

export interface ManifestModule {
  type: string;
  uuid: string;
  version: VersionTuple;
  language?: string;
  entry?: string;
  [key: string]: unknown;
}

export interface ManifestDependency {
  uuid?: string;
  module_name?: string;
  version: string | VersionTuple;
  [key: string]: unknown;
}

export interface ManifestJson {
  format_version: number;
  header: ManifestHeader;
  modules: ManifestModule[];
  dependencies?: ManifestDependency[];
  [key: string]: unknown;
}

export function manifestPath(root: string, packDir = ''): string {
  return path.join(root, packDir, 'manifest.json');
}

export function readManifest(file: string): Promise<ManifestJson> {
  return readJson<ManifestJson>(file);
}

export async function patchManifest(
  file: string,
  patcher: (manifest: ManifestJson) => void | Promise<void>,
): Promise<ManifestJson> {
  return patchJson<ManifestJson>(file, patcher);
}

export async function setManifestIdentity(
  file: string,
  options: {
    name?: string;
    description?: string;
    minEngineVersion?: VersionTuple;
    regenerateUuids?: boolean;
  },
): Promise<ManifestJson> {
  return patchManifest(file, (manifest) => {
    if (options.name) manifest.header.name = options.name;
    if (options.description !== undefined) manifest.header.description = options.description;
    if (options.minEngineVersion) manifest.header.min_engine_version = options.minEngineVersion;

    if (options.regenerateUuids) regenerateManifestUuids(manifest);
  });
}

export function regenerateManifestUuids(manifest: ManifestJson): void {
  manifest.header.uuid = crypto.randomUUID();
  for (const module of manifest.modules) module.uuid = crypto.randomUUID();
}

export function setScriptDependencyVersion(
  manifest: ManifestJson,
  moduleName: string,
  version: string,
): void {
  manifest.dependencies ??= [];

  const dependency = manifest.dependencies.find((item) => item.module_name === moduleName);
  if (dependency) {
    dependency.version = version;
    return;
  }

  manifest.dependencies.push({ module_name: moduleName, version });
}
