import { lstatSync, readFileSync, readlinkSync } from 'node:fs';
import {
  CODE_LIMITS,
  type FileContent,
  isCommitSha,
  type RepoPaths,
  type RepoTree,
  type SearchMatch,
  type SearchResult,
  WORKING_REF,
} from '@shinsa/core';
import { Context, Effect, Layer } from 'effect';
import type { GitRead } from '../schema.ts';
import { Git } from '../service.ts';
import { decodeText, splitRecords } from '../text.ts';
import {
  capPaths,
  describeAbsent,
  describeBytes,
  isBatchName,
  listTreeRecords,
  parseMatch,
  parseTreeObject,
  resolveGrepPattern,
  resolvePathspec,
  sortEntries,
} from './entries.ts';
import {
  type BatchReader,
  type BlobRef,
  CodeReadFailed,
  LIST_BYTES,
  ObjectReaderStopped,
  SEARCH_BYTES,
  type SearchQuery,
  VERIFIED_LIMIT,
} from './schema.ts';

export class CodeFiles extends Context.Service<
  CodeFiles,
  {
    assertCommit(repoPath: string, sha: string, signal?: AbortSignal): Effect.Effect<string, CodeReadFailed>;
    listCommitPaths(
      repoPath: string,
      sha: string,
      signal?: AbortSignal
    ): Effect.Effect<RepoPaths, CodeReadFailed>;
    listWorkingPaths(worktree: string, signal?: AbortSignal): Effect.Effect<RepoPaths, CodeReadFailed>;
    listCommitTree(
      repoPath: string,
      sha: string,
      dir: string,
      signal?: AbortSignal,
      reader?: BatchReader
    ): Effect.Effect<RepoTree, CodeReadFailed | ObjectReaderStopped>;
    selectBlob(
      repoPath: string,
      sha: string,
      path: string,
      signal?: AbortSignal,
      reader?: BatchReader
    ): Effect.Effect<BlobRef | null, CodeReadFailed | ObjectReaderStopped>;
    readObject(
      repoPath: string,
      object: string,
      signal?: AbortSignal,
      reader?: BatchReader
    ): Effect.Effect<Uint8Array, CodeReadFailed | ObjectReaderStopped>;
    readWorkingBytes(absolute: string): Effect.Effect<Uint8Array | null>;
    readWorkingFile(absolute: string, path: string): Effect.Effect<FileContent>;
    search(
      cwd: string,
      sha: string | null,
      search: SearchQuery,
      signal?: AbortSignal,
      onMatches?: (matches: SearchMatch[]) => void
    ): Effect.Effect<SearchResult, CodeReadFailed>;
  }
>()('shinsa/engine/git/tree/CodeFiles') {
  static readonly layer = Layer.effect(
    CodeFiles,
    Effect.gen(function* () {
      const git = yield* Git;
      const verified = new Set<string>();

      const assertRead = (read: GitRead, what: string) => {
        if (read.ok) return Effect.succeed(read);
        if (read.timedOut) {
          return Effect.fail(
            new CodeReadFailed({ code: 'read_timeout', message: `Reading ${what} took too long.` })
          );
        }
        return Effect.fail(
          new CodeReadFailed({
            code: 'read_failed',
            message: `Shinsa could not read ${what}: ${read.stderr || `exit ${read.code}`}`,
          })
        );
      };

      const ask = <A>(call: () => Promise<A>) =>
        Effect.tryPromise({
          try: call,
          catch: (error) =>
            new ObjectReaderStopped({ message: error instanceof Error ? error.message : String(error) }),
        });

      const assertCommit = Effect.fn('CodeFiles.assertCommit')(function* (
        repoPath: string,
        sha: string,
        signal?: AbortSignal
      ) {
        if (!isCommitSha(sha)) {
          return yield* new CodeReadFailed({
            code: 'ref_invalid',
            message: `Name a commit by its full id, or “${WORKING_REF}” for the working copy.`,
          });
        }
        const key = `${repoPath}\0${sha}`;
        if (verified.has(key)) return sha;
        const read = yield* git.read(['cat-file', '-t', sha], repoPath, { signal });
        if (!read.ok || decodeText(read.bytes).trim() !== 'commit') {
          return yield* new CodeReadFailed({
            code: 'ref_unknown',
            message: 'The repository has no such commit.',
          });
        }
        if (verified.size >= VERIFIED_LIMIT) verified.clear();
        verified.add(key);
        return sha;
      });

      const listCommitPaths = Effect.fn('CodeFiles.listCommitPaths')(function* (
        repoPath: string,
        sha: string,
        signal?: AbortSignal
      ) {
        const read = yield* assertRead(
          yield* git.read(['ls-tree', '-r', '-z', '--name-only', '--full-tree', sha], repoPath, {
            signal,
            maxBytes: LIST_BYTES,
          }),
          'the files'
        );
        const paths = splitRecords(read.bytes);
        return capPaths(read.truncated ? paths.slice(0, -1) : paths, sha);
      });

      const listWorkingPaths = Effect.fn('CodeFiles.listWorkingPaths')(function* (
        worktree: string,
        signal?: AbortSignal
      ) {
        const [listed, deleted] = yield* Effect.all(
          [
            git.read(['ls-files', '-z', '--cached', '--others', '--exclude-standard'], worktree, {
              signal,
              maxBytes: LIST_BYTES,
            }),
            git.read(['ls-files', '-z', '--deleted'], worktree, { signal, maxBytes: LIST_BYTES }),
          ],
          { concurrency: 'unbounded' }
        );
        const gone = new Set(splitRecords((yield* assertRead(deleted, 'the files')).bytes));
        const paths = [...new Set(splitRecords((yield* assertRead(listed, 'the files')).bytes))].filter(
          (path) => !gone.has(path)
        );
        return capPaths(paths.sort(), WORKING_REF);
      });

      const listBatchTree = Effect.fnUntraced(function* (sha: string, dir: string, reader: BatchReader) {
        const info = yield* ask(() => reader.info(`${sha}:${dir}`));
        if (info?.type !== 'tree') return { ref: sha, dir, entries: [] } satisfies RepoTree;
        const contents = yield* ask(() => reader.contents(info.object));
        const records = parseTreeObject(contents, dir, info.object.length / 2);
        const sizes = yield* Effect.forEach(
          records,
          (record) =>
            record.entry.kind === 'file' || record.entry.kind === 'symlink'
              ? ask(() => reader.info(record.object))
              : Effect.succeed(null),
          { concurrency: 'unbounded' }
        );
        const entries = records.map((record, index) => ({
          ...record.entry,
          size: sizes[index]?.size ?? null,
        }));
        return { ref: sha, dir, entries: sortEntries(entries) } satisfies RepoTree;
      });

      const listCommitTree = Effect.fn('CodeFiles.listCommitTree')(function* (
        repoPath: string,
        sha: string,
        dir: string,
        signal?: AbortSignal,
        reader?: BatchReader
      ) {
        if (reader && isBatchName(`${sha}:${dir}`)) return yield* listBatchTree(sha, dir, reader);
        const args = ['ls-tree', '-z', '--long', '--full-tree', sha, ...(dir ? ['--', `${dir}/`] : [])];
        const read = yield* assertRead(
          yield* git.read(args, repoPath, { signal, maxBytes: LIST_BYTES }),
          'the folder'
        );
        return {
          ref: sha,
          dir,
          entries: sortEntries(listTreeRecords(read.bytes).map((record) => record.entry)),
        } satisfies RepoTree;
      });

      const selectBlob = Effect.fn('CodeFiles.selectBlob')(function* (
        repoPath: string,
        sha: string,
        path: string,
        signal?: AbortSignal,
        reader?: BatchReader
      ) {
        const name = `${sha}:${path}`;
        if (reader && isBatchName(name)) {
          const info = yield* ask(() => reader.info(name));
          return info?.type === 'blob' ? { object: info.object, size: info.size } : null;
        }
        const read = yield* assertRead(
          yield* git.read(['ls-tree', '-z', '--long', '--full-tree', sha, '--', path], repoPath, { signal }),
          path
        );
        const record = listTreeRecords(read.bytes).find((candidate) => candidate.entry.path === path);
        if (!record || (record.entry.kind !== 'file' && record.entry.kind !== 'symlink')) return null;
        return { object: record.object, size: record.entry.size ?? 0 };
      });

      const readObject = Effect.fn('CodeFiles.readObject')(function* (
        repoPath: string,
        object: string,
        signal?: AbortSignal,
        reader?: BatchReader
      ) {
        if (reader) return yield* ask(() => reader.contents(object));
        const read = yield* git.read(['cat-file', 'blob', object], repoPath, {
          signal,
          maxBytes: CODE_LIMITS.blobBytes,
        });
        return (yield* assertRead(read, 'the file')).bytes;
      });

      const statPath = (absolute: string) =>
        Effect.orElseSucceed(
          Effect.try(() => lstatSync(absolute)),
          () => null
        );

      const readWorkingBytes = Effect.fn('CodeFiles.readWorkingBytes')(function* (absolute: string) {
        const stat = yield* statPath(absolute);
        if (!stat?.isFile() || stat.size > CODE_LIMITS.blobBytes) return null;
        return yield* Effect.sync(() => new Uint8Array(readFileSync(absolute)));
      });

      const readWorkingFile = Effect.fn('CodeFiles.readWorkingFile')(function* (
        absolute: string,
        path: string
      ) {
        const stat = yield* statPath(absolute);
        if (stat?.isSymbolicLink()) {
          const target = new TextEncoder().encode(yield* Effect.sync(() => readlinkSync(absolute)));
          return describeBytes(WORKING_REF, path, target, target.length);
        }
        if (!stat?.isFile()) return describeAbsent(WORKING_REF, path, 0, false);
        if (stat.size > CODE_LIMITS.blobBytes) return describeAbsent(WORKING_REF, path, stat.size, true);
        const bytes = yield* Effect.sync(() => new Uint8Array(readFileSync(absolute)));
        return describeBytes(WORKING_REF, path, bytes, stat.size);
      });

      const matchReader = (sha: string | null, onMatches: (matches: SearchMatch[]) => void) => {
        const decoder = new TextDecoder();
        let pending = '';
        let sent = 0;
        return (chunk: Uint8Array) =>
          Effect.sync(() => {
            const lines = `${pending}${decoder.decode(chunk, { stream: true })}`.split('\n');
            pending = lines.pop() ?? '';
            const matches = lines
              .map((record) => parseMatch(record, sha))
              .filter((match): match is SearchMatch => match !== null)
              .slice(0, Math.max(0, CODE_LIMITS.matches - sent));
            sent += matches.length;
            if (matches.length > 0) onMatches(matches);
          });
      };

      const search = Effect.fn('CodeFiles.search')(function* (
        cwd: string,
        sha: string | null,
        query: SearchQuery,
        signal?: AbortSignal,
        onMatches?: (matches: SearchMatch[]) => void
      ) {
        const grep = resolveGrepPattern(query);
        const args = [
          'grep',
          '-n',
          '-I',
          '--column',
          '-z',
          '--no-color',
          '--full-name',
          ...grep.flags,
          ...(query.wholeWord ? ['-w'] : []),
          '-e',
          grep.pattern,
          ...(sha ? [sha] : ['--untracked']),
          '--',
          ...resolvePathspec(query.glob),
        ];
        const read = yield* git.read(args, cwd, {
          signal,
          literal: false,
          maxBytes: SEARCH_BYTES,
          maxLines: CODE_LIMITS.matches,
          onData: onMatches ? matchReader(sha, onMatches) : undefined,
        });
        if (!read.ok && !read.timedOut && read.code !== 1) yield* assertRead(read, 'the search');
        const lines = decodeText(read.bytes).split('\n');
        if (read.timedOut || read.truncated) lines.pop();
        const matches = lines
          .map((record) => parseMatch(record, sha))
          .filter((match): match is SearchMatch => match !== null);
        return {
          ref: sha ?? WORKING_REF,
          matches: matches.slice(0, CODE_LIMITS.matches),
          truncated: read.truncated || matches.length > CODE_LIMITS.matches,
          timedOut: read.timedOut,
        } satisfies SearchResult;
      });

      return CodeFiles.of({
        assertCommit,
        listCommitPaths,
        listWorkingPaths,
        listCommitTree,
        selectBlob,
        readObject,
        readWorkingBytes,
        readWorkingFile,
        search,
      });
    })
  );
}
