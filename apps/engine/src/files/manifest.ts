import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Effect, Option, Schema } from 'effect';
import { selectText } from './probe.ts';
import {
  DenoManifestText,
  PACKAGE_MANIFEST,
  type PackageManifest,
  PackageManifestText,
  TextList,
} from './schema.ts';

const decodeManifest = Schema.decodeUnknownOption(PackageManifestText);

const decodeDeno = Schema.decodeUnknownOption(DenoManifestText);

const isWorkspaceList = Schema.is(TextList);

export function parsePackageManifest(text: string | null): PackageManifest | null {
  return text === null ? null : Option.getOrNull(decodeManifest(text));
}

export const selectPackageManifest = Effect.fn('Files.selectPackageManifest')(function* (dir: string) {
  const text = yield* selectText(join(dir, PACKAGE_MANIFEST));
  return Option.flatMap(text, decodeManifest);
});

export function findManifestFile<A>(path: string, schema: Schema.Decoder<A>): A {
  return Schema.decodeUnknownSync(schema)(readFileSync(path, 'utf8'));
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
