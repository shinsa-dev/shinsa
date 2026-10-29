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
import { describeError, log } from '../log/index.ts';
import { EVIDENCE_ROUTE, type EvidenceStore } from '../store/evidence.ts';
import { type Attachment, resolveRepositoryId, uploadAttachment } from './index.ts';

const MEGABYTE = 1024 * 1024;

const IMAGE_LIMIT_BYTES = 10 * MEGABYTE;

const VIDEO_LIMIT_BYTES = 100 * MEGABYTE;

const ATTACHMENT_TYPES: Record<string, { contentType: string; limit: number }> = {
  '.png': { contentType: 'image/png', limit: IMAGE_LIMIT_BYTES },
  '.jpg': { contentType: 'image/jpeg', limit: IMAGE_LIMIT_BYTES },
  '.jpeg': { contentType: 'image/jpeg', limit: IMAGE_LIMIT_BYTES },
  '.gif': { contentType: 'image/gif', limit: IMAGE_LIMIT_BYTES },
  '.webp': { contentType: 'image/webp', limit: IMAGE_LIMIT_BYTES },
  '.mp4': { contentType: 'video/mp4', limit: VIDEO_LIMIT_BYTES },
  '.mov': { contentType: 'video/quicktime', limit: VIDEO_LIMIT_BYTES },
  '.webm': { contentType: 'video/webm', limit: VIDEO_LIMIT_BYTES },
};

interface PullRequestDescription {
  body: string;
  uploads: EvidenceUpload[];
}

export class PullRequestDescriptions {
  readonly #evidence: EvidenceStore;
  readonly #repositoryIds = new Map<string, number>();

  constructor(evidence: EvidenceStore) {
    this.#evidence = evidence;
  }

  async describe(
    repo: Repo,
    task: Task,
    evidence: readonly Evidence[],
    signal?: AbortSignal
  ): Promise<PullRequestDescription> {
    const items = listPullRequestEvidence(task, evidence);
    const uploads = await this.#upload(
      repo,
      task,
      items.flatMap((item) => item.parts),
      signal
    );
    const uploaded = new Map(uploads.map((upload) => [upload.evidenceId, upload.url]));
    const published = evidence.map((piece) => {
      const url = uploaded.get(piece.id);
      return url ? { ...piece, uploadUrl: url } : piece;
    });
    const notes = Object.fromEntries(
      items
        .filter((item) => item.kind === 'note')
        .flatMap((item) => item.parts)
        .flatMap((piece) => {
          const text = this.#readText(piece);
          return text === null ? [] : [[piece.id, text]];
        })
    );
    return { body: serializePullRequestMarkdown({ task, evidence: published, notes }), uploads };
  }

  #selectPath(piece: Evidence) {
    if (!piece.uri.startsWith(EVIDENCE_ROUTE)) return null;
    return this.#evidence.selectFile(piece.uri.slice(EVIDENCE_ROUTE.length));
  }

  #readText(piece: Evidence) {
    const path = this.#selectPath(piece);
    return path ? readFileSync(path, 'utf8') : null;
  }

  #selectAttachment(piece: Evidence): Attachment | null {
    if (piece.kind !== 'screenshot' && piece.kind !== 'recording') return null;
    if (resolvePublicUrl(piece) !== null) return null;
    const path = this.#selectPath(piece);
    const type = path ? ATTACHMENT_TYPES[extname(path).toLowerCase()] : undefined;
    if (!path || !type || statSync(path).size > type.limit) return null;
    return { path, name: basename(path), contentType: type.contentType };
  }

  async #resolveRepositoryId(repo: Repo, signal?: AbortSignal) {
    const known = this.#repositoryIds.get(repo.id);
    if (known !== undefined) return known;
    const id = await resolveRepositoryId(repo, signal);
    this.#repositoryIds.set(repo.id, id);
    return id;
  }

  async #upload(repo: Repo, task: Task, pieces: readonly Evidence[], signal?: AbortSignal) {
    const pending = pieces.flatMap((piece) => {
      const attachment = this.#selectAttachment(piece);
      return attachment ? [{ piece, attachment }] : [];
    });
    if (pending.length === 0) return [];
    let repositoryId: number;
    try {
      repositoryId = await this.#resolveRepositoryId(repo, signal);
    } catch (error) {
      log.warn('[GitHub] Could not read the repository id; the description links evidence to Shinsa', {
        taskId: task.id,
        repoId: repo.id,
        error: describeError(error),
      });
      return [];
    }
    const uploads: EvidenceUpload[] = [];
    for (const { piece, attachment } of pending) {
      try {
        const url = await uploadAttachment(repo, repositoryId, attachment, signal);
        uploads.push({ evidenceId: piece.id, url });
      } catch (error) {
        log.warn('[GitHub] Could not upload evidence; the description links it to Shinsa', {
          taskId: task.id,
          evidenceId: piece.id,
          error: describeError(error),
        });
      }
    }
    return uploads;
  }
}
