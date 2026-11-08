import { dirname, join } from 'node:path';
import { Effect, FileSystem } from 'effect';
import { TerminalFiles } from '../../apps/engine/src/terminals/store/service.ts';
import { CHAT_PROTOCOL_VERSION, type Project, type Repo } from '../../packages/core/src/index.ts';
import type { SeedTranscript } from './kit.ts';
import type { Files } from './paths.ts';
import { listSeedServices } from './services.ts';

export const writeSeedFile = Effect.fn('Seed.writeFile')(function* (
  path: string,
  content: string | Uint8Array
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(dirname(path), { recursive: true });
  if (typeof content === 'string') yield* fs.writeFileString(path, content);
  else yield* fs.writeFile(path, content);
});

export const writeSeedFiles = Effect.fn('Seed.writeFiles')(function* (root: string, files: Files) {
  for (const [path, content] of Object.entries(files)) yield* writeSeedFile(join(root, path), content);
});

export const readSeedText = Effect.fn('Seed.readText')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  return yield* fs.readFileString(path);
});

export const removeSeedPath = Effect.fn('Seed.removePath')(function* (path: string) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(path, { recursive: true, force: true });
});

function serializeTranscript({ runId, timed }: SeedTranscript) {
  const lines = timed.map(({ at, event }, index) =>
    JSON.stringify({ ...event, v: CHAT_PROTOCOL_VERSION, id: `${runId}-${index}`, at })
  );
  return `${lines.join('\n')}\n`;
}

export const writeSeedTranscripts = Effect.fn('Seed.writeTranscripts')(function* (
  dir: string,
  transcripts: readonly SeedTranscript[]
) {
  for (const transcript of transcripts)
    yield* writeSeedFile(join(dir, `${transcript.runId}.jsonl`), serializeTranscript(transcript));
});

export const writeSeedServices = Effect.fn('Seed.writeServices')(function* (
  dataDir: string,
  projects: readonly Project[],
  repos: readonly Repo[]
) {
  const files = yield* TerminalFiles;
  const services = listSeedServices(projects, repos);
  yield* files.writeServices(dataDir, services);
  return services;
});
