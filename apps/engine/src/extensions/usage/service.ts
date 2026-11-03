import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Context, Effect, Layer, Option, Predicate, Schema } from 'effect';
import { NEWLINE } from '../../files/schema.ts';
import { describeError } from '../../log/redact.ts';
import {
  CLAUDE_TOOL_USE,
  DAY_MS,
  LOADER_TOOLS,
  SESSION_TIMESTAMP,
  SHINSA_USAGE_MARKERS,
  TranscriptLine,
  TranscriptToolCall,
  type UsageFile,
  type UsageScan,
  type UsageSourceKind,
} from '../schema.ts';
import { ExtensionFiles } from '../store/service.ts';
import { normalizeServerName } from './names.ts';

export class ExtensionUsage extends Context.Service<
  ExtensionUsage,
  { scan(scan: UsageScan, previous: UsageFile): Effect.Effect<UsageFile> }
>()('shinsa/engine/extensions/usage/ExtensionUsage') {
  static readonly layer = Layer.effect(
    ExtensionUsage,
    Effect.gen(function* () {
      const files = yield* ExtensionFiles;
      const decodeLine = Schema.decodeUnknownEffect(TranscriptLine);
      const decodeToolCall = Schema.decodeUnknownOption(TranscriptToolCall);

      const listSessionFiles = (dir: string) =>
        existsSync(dir)
          ? readdirSync(dir, { recursive: true, encoding: 'utf8' })
              .filter((entry) => entry.endsWith('.jsonl'))
              .map((entry) => join(dir, entry))
          : [];

      const recordLatest = (target: Record<string, number>, key: string, at: number) => {
        if (!key || !Number.isFinite(at)) return;
        if ((target[key] ?? 0) < at) target[key] = at;
      };

      const readLineAround = (text: string, index: number) => {
        const start = text.lastIndexOf('\n', index) + 1;
        const end = text.indexOf('\n', index);
        return text.slice(start, end === -1 ? text.length : end);
      };

      const readClaude = (next: UsageFile, text: string) => {
        for (const match of text.matchAll(CLAUDE_TOOL_USE)) {
          const stamp = SESSION_TIMESTAMP.exec(readLineAround(text, match.index))?.[1];
          const at = stamp ? Date.parse(stamp) : Number.NaN;
          const [, name = '', skill] = match;
          if (name === 'Skill') {
            if (skill) recordLatest(next.skills, skill, at);
            continue;
          }
          const server = name.slice('mcp__'.length).split('__')[0] ?? '';
          recordLatest(next.servers, normalizeServerName(server), at);
        }
      };

      const readShinsaEntry = (next: UsageFile, value: unknown) => {
        const entry = decodeToolCall(value);
        if (Option.isNone(entry)) return;
        const { at, tool } = entry.value;
        const args = tool.args ?? {};
        if (tool.kind === 'other' && tool.name === 'Skill' && Predicate.isString(args.skill)) {
          recordLatest(next.skills, args.skill, at);
          return;
        }
        if (tool.kind !== 'mcp' || !Predicate.isString(tool.server)) return;
        if (tool.server === 'shinsa' && Predicate.isString(tool.name) && LOADER_TOOLS.has(tool.name)) {
          const loaded = Predicate.isString(args.name) ? args.name : args.server;
          if (Predicate.isString(loaded)) recordLatest(next.servers, normalizeServerName(loaded), at);
          return;
        }
        recordLatest(next.labels, tool.server, at);
      };

      const readShinsa = Effect.fn('ExtensionUsage.readShinsa')(function* (
        next: UsageFile,
        text: string,
        path: string
      ) {
        for (const line of text.split('\n')) {
          if (!SHINSA_USAGE_MARKERS.some((marker) => line.includes(marker))) continue;
          yield* decodeLine(line).pipe(
            Effect.map((value) => readShinsaEntry(next, value)),
            Effect.catch((error) =>
              Effect.logWarning('[Extensions] Skipped a transcript line it could not read for usage').pipe(
                Effect.annotateLogs({ path, error: error.message })
              )
            )
          );
        }
      });

      const readFrom = Effect.fn('ExtensionUsage.readFrom')(function* (
        scan: UsageScan,
        next: UsageFile,
        kind: UsageSourceKind,
        path: string,
        start: number,
        size: number
      ) {
        let chunk = scan.chunkBytes;
        const decoder = new TextDecoder();
        let offset = start;
        while (offset < size) {
          const end = Math.min(size, offset + chunk);
          const bytes = new Uint8Array(
            yield* Effect.tryPromise({
              try: () => Bun.file(path).slice(offset, end).arrayBuffer(),
              catch: describeError,
            })
          );
          const last = bytes.lastIndexOf(NEWLINE);
          if (last === -1) {
            if (end >= size) return offset;
            chunk *= 2;
            continue;
          }
          const text = decoder.decode(bytes.subarray(0, last + 1));
          if (kind === 'claude') readClaude(next, text);
          else yield* readShinsa(next, text, path);
          offset += last + 1;
        }
        return offset;
      });

      const scanFile = Effect.fn('ExtensionUsage.scanFile')(function* (
        scan: UsageScan,
        previous: UsageFile,
        next: UsageFile,
        kind: UsageSourceKind,
        path: string,
        horizon: number
      ) {
        const stat = statSync(path, { throwIfNoEntry: false });
        if (!stat || stat.mtimeMs < horizon) return;
        const known = previous.files[path];
        if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs) {
          next.files[path] = known;
          return;
        }
        const start = known && known.size <= stat.size ? known.offset : 0;
        yield* Effect.suspend(() => readFrom(scan, next, kind, path, start, stat.size)).pipe(
          Effect.tap((offset) =>
            Effect.sync(() => {
              next.files[path] = { size: stat.size, mtimeMs: stat.mtimeMs, offset };
            })
          ),
          Effect.catch((error) =>
            Effect.logWarning('[Extensions] Could not read a session for usage').pipe(
              Effect.annotateLogs({ path, error })
            )
          )
        );
      });

      const scan = Effect.fn('ExtensionUsage.scan')(function* (request: UsageScan, previous: UsageFile) {
        const horizon = request.now - request.horizonDays * DAY_MS;
        const next: UsageFile = {
          ...previous,
          files: {},
          servers: { ...previous.servers },
          labels: { ...previous.labels },
          skills: { ...previous.skills },
        };
        for (const source of request.sources) {
          for (const path of listSessionFiles(source.dir)) {
            yield* scanFile(request, previous, next, source.kind, path, horizon);
          }
        }
        const read: UsageFile = {
          ...next,
          readAt: request.now,
          since: Math.min(next.since ?? horizon, horizon),
        };
        yield* files.writeUsage(request.cachePath, read);
        return read;
      });

      return ExtensionUsage.of({ scan });
    })
  );
}
