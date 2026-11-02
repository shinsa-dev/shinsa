import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Option, Schema } from 'effect';
import {
  DenoManifestText,
  PACKAGE_MANIFEST,
  type PackageManifest,
  PackageManifestText,
  TextList,
} from './schema.ts';

const readText = Option.liftThrowable((path: string) => readFileSync(path, 'utf8'));

const decodeManifest = Schema.decodeUnknownOption(PackageManifestText);

const decodeDeno = Schema.decodeUnknownOption(DenoManifestText);

const isWorkspaceList = Schema.is(TextList);

export function parsePackageManifest(text: string | null): PackageManifest | null {
  return text === null ? null : Option.getOrNull(decodeManifest(text));
}

export function readPackageManifest(dir: string): PackageManifest | null {
  return Option.getOrNull(Option.flatMap(readText(join(dir, PACKAGE_MANIFEST)), decodeManifest));
}

export function listDependencyNames(manifest: PackageManifest) {
  return [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})];
}

export function listWorkspacePatterns(manifest: PackageManifest): readonly string[] {
  const { workspaces = [] } = manifest;
  return isWorkspaceList(workspaces) ? workspaces : (workspaces.packages ?? []);
}

export function parseDenoTasks(text: string | null): Record<string, string> {
  if (text === null) return {};
  return Option.match(decodeDeno(text), {
    onNone: () => ({}),
    onSome: (manifest) => ({ ...manifest.tasks }),
  });
}
