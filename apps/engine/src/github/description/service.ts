import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import {
  type Evidence,
  type EvidenceUpload,
  listPullRequestEvidence,
  type Repo,
  resolvePublicUrl,
  serializePullRequestMarkdown,
  type Task,
} from '@shinsa/core';
import { Context, Effect, Layer, Option, Ref } from 'effect';
import { describeError } from '../../log/redact.ts';
import { EVIDENCE_ROUTE } from '../../store/evidence/schema.ts';
import { Evidence as EvidenceFiles } from '../../store/evidence/service.ts';
import type { Attachment } from '../pulls/schema.ts';
import { PullRequests } from '../pulls/service.ts';
import { serializeReviewLink } from './link.ts';
import { ATTACHMENT_TYPES, type PullRequestDescription } from './schema.ts';

export class PullRequestDescriber extends Context.Service<
  PullRequestDescriber,
  {
    describe(
      repo: Repo,
      task: Task,
      evidence: readonly Evidence[],
      signal?: AbortSignal
    ): Effect.Effect<PullRequestDescription>;
  }
>()('shinsa/engine/github/description/PullRequestDescriber') {
  static readonly layer = Layer.effect(
    PullRequestDescriber,
    Effect.gen(function* () {
      const pulls = yield* PullRequests;
      const files = yield* EvidenceFiles;
      const repositoryIds = yield* Ref.make(new Map<string, number>());

      const selectPath = (piece: Evidence) =>
        piece.uri.startsWith(EVIDENCE_ROUTE)
          ? Effect.map(files.selectFile(piece.uri.slice(EVIDENCE_ROUTE.length)), Option.getOrNull)
          : Effect.succeed(null);

      const selectAttachment = Effect.fn('PullRequestDescriber.selectAttachment')(function* (
        piece: Evidence
      ) {
        if (piece.kind !== 'screenshot' && piece.kind !== 'recording') return null;
        if (resolvePublicUrl(piece) !== null) return null;
        const path = yield* selectPath(piece);
        const type = path ? ATTACHMENT_TYPES[extname(path).toLowerCase()] : undefined;
        if (!path || !type || statSync(path).size > type.limit) return null;
        const attachment: Attachment = { path, name: basename(path), contentType: type.contentType };
        return attachment;
      });
      const resolveRepositoryId = Effect.fn('PullRequestDescriber.resolveRepositoryId')(function* (
        repo: Repo,
        signal?: AbortSignal
      ) {
        const known = (yield* Ref.get(repositoryIds)).get(repo.id);
        if (known !== undefined) return known;
        const id = yield* pulls.repositoryId(repo, signal);
        yield* Ref.update(repositoryIds, (ids) => new Map(ids).set(repo.id, id));
        return id;
      });

      const upload = Effect.fn('PullRequestDescriber.upload')(function* (
        repo: Repo,
        task: Task,
        pieces: readonly Evidence[],
        signal?: AbortSignal
      ) {
        const pending = (yield* Effect.forEach(pieces, (piece) =>
          Effect.map(selectAttachment(piece), (attachment) => (attachment ? [{ piece, attachment }] : []))
        )).flat();
        if (pending.length === 0) return [];
        const repositoryId = yield* resolveRepositoryId(repo, signal).pipe(
          Effect.tapError((error) =>
            Effect.logWarning(
              '[GitHub] Could not read the repository id; the description links evidence to Shinsa'
            ).pipe(Effect.annotateLogs({ taskId: task.id, repoId: repo.id, error: describeError(error) }))
          ),
          Effect.option
        );
        if (repositoryId._tag === 'None') return [];
        const uploads: EvidenceUpload[] = [];
        for (const { piece, attachment } of pending) {
          yield* pulls.upload(repo, repositoryId.value, attachment, signal).pipe(
            Effect.flatMap((url) => Effect.sync(() => uploads.push({ evidenceId: piece.id, url }))),
            Effect.catch((error) =>
              Effect.logWarning(
                '[GitHub] Could not upload evidence; the description links it to Shinsa'
              ).pipe(
                Effect.annotateLogs({ taskId: task.id, evidenceId: piece.id, error: describeError(error) })
              )
            )
          );
        }
        return uploads;
      });

      const describe = Effect.fn('PullRequestDescriber.describe')(function* (
        repo: Repo,
        task: Task,
        evidence: readonly Evidence[],
        signal?: AbortSignal
      ) {
        const items = listPullRequestEvidence(task, evidence);
        const uploads = yield* upload(
          repo,
          task,
          items.flatMap((item) => item.parts),
          signal
        );
        const uploaded = new Map(uploads.map((entry) => [entry.evidenceId, entry.url]));
        const published = evidence.map((piece) => {
          const url = uploaded.get(piece.id);
          return url ? { ...piece, uploadUrl: url } : piece;
        });
        const notePieces = items.filter((item) => item.kind === 'note').flatMap((item) => item.parts);
        const notes = Object.fromEntries(
          (yield* Effect.forEach(notePieces, (piece) =>
            Effect.map(selectPath(piece), (path): [string, string][] =>
              path ? [[piece.id, readFileSync(path, 'utf8')]] : []
            )
          )).flat()
        );
        const review = serializeReviewLink(task, published, repo);
        return {
          body: serializePullRequestMarkdown({ task, evidence: published, notes, review }),
          uploads,
        };
      });

      return PullRequestDescriber.of({ describe });
    })
  );
}
