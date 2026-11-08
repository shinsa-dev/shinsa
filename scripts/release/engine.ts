import { join } from 'node:path';
import { Config, Effect, FileSystem, Option, Schema } from 'effect';
import { Command } from '../kit/command/index.ts';
import { createTempDirectory } from '../kit/temp.ts';
import { EngineInvalid, EngineVersionReport, ScriptUsage } from './schema.ts';

export const PUBLISHED_ENGINE_TARGETS = ['bun-darwin-arm64', 'bun-linux-x64', 'bun-linux-arm64'] as const;

export type PublishedEngineTarget = (typeof PUBLISHED_ENGINE_TARGETS)[number];

export interface EngineArchive {
  folder: string;
  archive: string;
  checksum: string;
}

export interface PackOptions {
  target: string;
  folder: string;
  outDir: string;
  version: string;
}

const ENGINE_BINARY = 'bin/shinsa';

const ENGINE_CONTENTS = [ENGINE_BINARY, 'plugin', 'web/index.html'];

const decodeTarget = Schema.decodeUnknownEffect(Schema.Literals(PUBLISHED_ENGINE_TARGETS));

const decodeVersionReport = Schema.decodeUnknownOption(Schema.fromJsonString(EngineVersionReport));

export const resolvePublishedTarget = Effect.fn('resolvePublishedTarget')(function* (requested: string) {
  return yield* decodeTarget(requested).pipe(
    Effect.mapError(
      () =>
        new EngineInvalid({
          message: `Unknown engine target ${requested}: use one of ${PUBLISHED_ENGINE_TARGETS.join(', ')}`,
        })
    )
  );
});

export function resolveEngineArchive(target: PublishedEngineTarget): EngineArchive {
  const folder = `shinsa-${target.replace(/^bun-/, '')}`;
  return { folder, archive: `${folder}.tar.gz`, checksum: `${folder}.tar.gz.sha256` };
}

export function serializeChecksum(sha256: string, name: string) {
  return `${sha256}  ${name}\n`;
}

export const assertEngineFolder = Effect.fn('assertEngineFolder')(function* (folder: string) {
  const fs = yield* FileSystem.FileSystem;
  const found = yield* Effect.forEach(ENGINE_CONTENTS, (entry) =>
    fs.stat(join(folder, entry)).pipe(
      Effect.option,
      Effect.map((info) => ({ entry, info }))
    )
  );
  const missing = found.filter(({ info }) => Option.isNone(info)).map(({ entry }) => entry);
  if (missing.length > 0)
    return yield* new EngineInvalid({
      message: `${folder} is not a built engine: it has no ${missing.join(', ')}`,
    });
  const executable = found.some(
    ({ entry, info }) => entry === ENGINE_BINARY && Option.exists(info, (stat) => (stat.mode & 0o111) !== 0)
  );
  if (!executable)
    return yield* new EngineInvalid({ message: `${join(folder, ENGINE_BINARY)} is not executable` });
});

const assertEngineVersion = Effect.fn('assertEngineVersion')(function* (binary: string, version: string) {
  const command = yield* Command;
  const result = yield* command.run([binary, 'version', '--json']);
  if (result.code !== 0)
    return yield* new EngineInvalid({
      message: `${binary} version failed (${result.code}): ${result.stderr}`,
    });
  const reported = decodeVersionReport(result.stdout).pipe(
    Option.flatMap((report) => Option.fromNullishOr(report.command?.version)),
    Option.getOrNull
  );
  if (reported !== version)
    return yield* new EngineInvalid({
      message: `The engine reports version ${reported ?? 'none'}, but the release is ${version}`,
    });
});

export const packEngine = Effect.fn('packEngine')(function* ({
  target,
  folder,
  outDir,
  version,
}: PackOptions) {
  const command = yield* Command;
  const fs = yield* FileSystem.FileSystem;
  const names = resolveEngineArchive(yield* resolvePublishedTarget(target));
  yield* assertEngineFolder(folder);
  yield* assertEngineVersion(join(folder, ENGINE_BINARY), version);
  const staging = yield* createTempDirectory('shinsa-pack-');
  const unwritable = (error: { readonly message: string }) =>
    new EngineInvalid({ message: `Could not pack ${names.archive}: ${error.message}` });
  yield* fs.copy(folder, join(staging, names.folder)).pipe(Effect.mapError(unwritable));
  yield* fs.makeDirectory(outDir, { recursive: true }).pipe(Effect.mapError(unwritable));
  const archive = join(outDir, names.archive);
  const tar = yield* command.run(['tar', '-czf', archive, '-C', staging, names.folder], {
    env: { COPYFILE_DISABLE: '1' },
  });
  if (tar.code !== 0)
    return yield* new EngineInvalid({ message: `Could not pack ${names.archive}: ${tar.stderr}` });
  const bytes = yield* fs.readFile(archive).pipe(Effect.mapError(unwritable));
  const sha256 = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
  yield* fs
    .writeFileString(join(outDir, names.checksum), serializeChecksum(sha256, names.archive))
    .pipe(Effect.mapError(unwritable));
  return { ...names, sha256 };
}, Effect.scoped);

export const runPackEngine = Effect.fn('runPackEngine')(function* (argv: readonly string[]) {
  const [target, folder, outDir] = argv;
  const version = (yield* Effect.orDie(Config.String('SHINSA_VERSION').pipe(Config.withDefault('')))).replace(
    /^v/,
    ''
  );
  if (!target || !folder || !outDir || !version)
    return yield* new ScriptUsage({
      message:
        'Usage: SHINSA_VERSION=<version> bun scripts/release-engine.ts <target> <engine folder> <out dir>',
    });
  const packed = yield* packEngine({ target, folder, outDir, version });
  return `Packed Shinsa ${version} for ${target} as ${packed.archive} (sha256 ${packed.sha256})`;
});
