import { join } from 'node:path';
import { Console, Effect, FileSystem, type PlatformError, Schema } from 'effect';
import { discoverIcons, isSkippedEntry, isSourceEntry, renderIconsModule, resolveKnownIcons } from './icons';
import { IconIndex, type IconsFileRequest, IconsNotFound, IconsOutOfDate } from './schema';

const decodeIndex = Schema.decodeUnknownEffect(Schema.fromJsonString(IconIndex));

export const listSourceFiles: (
  dir: string
) => Effect.Effect<string[], PlatformError.PlatformError, FileSystem.FileSystem> = Effect.fn(
  'Icons.listSourceFiles'
)(function* (dir: string) {
  const fs = yield* FileSystem.FileSystem;
  const entries = (yield* fs.readDirectory(dir)).filter((entry) => !isSkippedEntry(entry));
  const nested = yield* Effect.forEach(
    entries,
    Effect.fn('Icons.listEntry')(function* (entry: string) {
      const path = join(dir, entry);
      const info = yield* fs.stat(path);
      if (info.type === 'Directory') return yield* listSourceFiles(path);
      return isSourceEntry(entry) ? [path] : [];
    })
  );
  return nested.flat();
});

export const generateIcons = Effect.fn('Icons.generate')(function* (
  request: Omit<IconsFileRequest, 'check'>
) {
  const fs = yield* FileSystem.FileSystem;
  const known = resolveKnownIcons(yield* decodeIndex(yield* fs.readFileString(request.index)));
  const files = (yield* Effect.forEach(request.roots, listSourceFiles))
    .flat()
    .filter((file) => file !== request.out);
  const sources = yield* Effect.forEach(files, (file) => fs.readFileString(file));
  const discovered = discoverIcons(sources, known);
  if (discovered.size === 0)
    return yield* new IconsNotFound({ message: 'No icon usages found. Did the scan roots change?' });
  return { module: renderIconsModule(discovered), icons: discovered.size };
});

export const syncIconsFile = Effect.fn('Icons.sync')(function* (request: IconsFileRequest) {
  const fs = yield* FileSystem.FileSystem;
  const { module, icons } = yield* generateIcons(request);
  const current = yield* fs.readFileString(request.out);
  if (request.check) {
    if (current !== module)
      return yield* new IconsOutOfDate({
        message: 'paths.ts is out of date. Run: bun run --cwd packages/ui generate:icons',
      });
    return yield* Console.log(`[icons] paths.ts is current (${icons} icons)`);
  }
  if (current !== module) yield* fs.writeFileString(request.out, module);
  return yield* Console.log(`[icons] ${icons} icons written to paths.ts`);
});
