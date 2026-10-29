import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { type Evidence, parseReviewPayload, type Task } from '@shinsa/core';
import { PullRequestDescriptions, serializeReviewLink } from '../../src/github/description.ts';
import { log } from '../../src/log/index.ts';
import { EvidenceStore } from '../../src/store/evidence.ts';
import { createTempDir, overrideEnv } from '../helpers/index.ts';
import { createRepo, createTask } from '../helpers/state.ts';

let restore: (() => void) | null = null;

afterEach(() => {
  restore?.();
  restore = null;
});

function useFakeGitHub(extra: { repositoryId?: number; failUploads?: boolean } = {}) {
  const path = join(createTempDir(), 'gh.json');
  writeFileSync(path, JSON.stringify({ next: 1, defaultChecks: 'pending', pulls: [], calls: [], ...extra }));
  restore = overrideEnv({ FAKE_GH_STATE: path });
  return { calls: () => (JSON.parse(readFileSync(path, 'utf8')) as { calls: string[][] }).calls };
}

function createStore() {
  const source = createTempDir();
  const store = new EvidenceStore(createTempDir());
  const folder = { taskId: 'task-1', round: 1 };
  const copy = (name: string, bytes = 'x') => {
    const file = join(source, name);
    writeFileSync(file, bytes);
    return store.copyFile(file, folder, name);
  };
  return { store, copy, note: (text: string) => store.writeText(text, folder, 'note', 'md') };
}

function piece(task: Task, id: string, fields: Pick<Evidence, 'kind' | 'uri'> & Partial<Evidence>): Evidence {
  return { id, taskId: task.id, runId: 'run-1', title: id, attachedAt: 1, ...fields };
}

describe('PullRequestDescriptions', () => {
  test('uploads the screenshots and recordings GitHub cannot reach yet, once per repository id', async () => {
    const github = useFakeGitHub({ repositoryId: 4242 });
    const { store, copy, note } = createStore();
    const task = createTask();
    const evidence = [
      piece(task, 'shot', { kind: 'screenshot', uri: copy('shot.png') }),
      piece(task, 'clip', { kind: 'recording', uri: copy('clip.MP4') }),
      piece(task, 'done', {
        kind: 'screenshot',
        uri: copy('done.png'),
        uploadUrl: 'https://github.com/user-attachments/assets/old',
      }),
      piece(task, 'web', { kind: 'screenshot', uri: 'https://cdn.example.com/web.png' }),
      piece(task, 'bitmap', { kind: 'screenshot', uri: copy('bitmap.bmp') }),
      piece(task, 'elsewhere', { kind: 'screenshot', uri: '/tmp/elsewhere.png' }),
      piece(task, 'notes', { kind: 'note', uri: note('Load time fell from 2s to 300ms.') }),
      piece(task, 'lost', { kind: 'note', uri: '/api/evidence/missing.md' }),
    ];
    const descriptions = new PullRequestDescriptions(store);
    const repo = createRepo({ path: createTempDir() });
    const first = await descriptions.describe(repo, task, evidence);
    expect(first.uploads).toEqual([
      { evidenceId: 'shot', url: 'https://github.com/user-attachments/assets/upload-1' },
      { evidenceId: 'clip', url: 'https://github.com/user-attachments/assets/upload-2' },
    ]);
    expect(first.body).toContain('![shot](https://github.com/user-attachments/assets/upload-1)');
    expect(first.body).toContain('\n\nhttps://github.com/user-attachments/assets/upload-2');
    expect(first.body).toContain('![done](https://github.com/user-attachments/assets/old)');
    expect(first.body).toContain('Load time fell from 2s to 300ms.');
    expect(first.body).toContain('- **bitmap**, a screenshot: [open it in Shinsa]');
    expect(first.body).toContain('- **elsewhere**, a screenshot: [open it in Shinsa]');
    expect(first.body).toContain('- **lost**, a note: [open it in Shinsa]');
    const uploads = github.calls().filter((call) => call[1]?.startsWith('https://uploads.github.com/'));
    expect(uploads.map((call) => call[1])).toEqual([
      expect.stringContaining('name=shot-'),
      expect.stringContaining('content_type=video%2Fmp4'),
    ]);
    await descriptions.describe(repo, task, evidence);
    expect(github.calls().filter((call) => call[1] === 'repos/acme/app')).toHaveLength(1);
  });

  test('with nothing to upload it never calls GitHub', async () => {
    const github = useFakeGitHub({ repositoryId: 4242 });
    const { store } = createStore();
    const task = createTask({ summary: 'Did it.' });
    const description = await new PullRequestDescriptions(store).describe(
      createRepo({ path: createTempDir() }),
      task,
      []
    );
    expect(description).toMatchObject({ uploads: [] });
    expect(description.body).toContain('Did it.');
    expect(github.calls()).toEqual([]);
  });

  test('a repository id GitHub will not give links the evidence to Shinsa and logs why', async () => {
    useFakeGitHub();
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const { store, copy } = createStore();
    const task = createTask();
    const evidence = [piece(task, 'shot', { kind: 'screenshot', uri: copy('shot.png') })];
    const description = await new PullRequestDescriptions(store).describe(
      createRepo({ path: createTempDir() }),
      task,
      evidence
    );
    expect(description.uploads).toEqual([]);
    expect(description.body).toContain('- **shot**, a screenshot: [open it in Shinsa]');
    expect(warn).toHaveBeenCalledWith(
      '[GitHub] Could not read the repository id; the description links evidence to Shinsa',
      expect.objectContaining({ taskId: task.id, repoId: 'repo-1' })
    );
    warn.mockRestore();
  });

  test('an upload GitHub refuses is logged and linked to Shinsa, the others still go up', async () => {
    useFakeGitHub({ repositoryId: 4242, failUploads: true });
    const warn = spyOn(log, 'warn').mockImplementation(() => undefined);
    const { store, copy } = createStore();
    const task = createTask();
    const evidence = [piece(task, 'shot', { kind: 'screenshot', uri: copy('shot.png') })];
    const description = await new PullRequestDescriptions(store).describe(
      createRepo({ path: createTempDir() }),
      task,
      evidence
    );
    expect(description.uploads).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      '[GitHub] Could not upload evidence; the description links it to Shinsa',
      expect.objectContaining({ taskId: task.id, evidenceId: 'shot' })
    );
    warn.mockRestore();
  });
});

describe('serializeReviewLink', () => {
  test('packs the review into a fragment the open page reads back, and leaves out one too long for a link', async () => {
    useFakeGitHub();
    const { store } = createStore();
    const task = createTask({ handle: 'LOC-28', summary: 'Did it.' });
    const evidence = [
      piece(task, 'web', { kind: 'screenshot', uri: 'https://cdn.example.com/web.png' }),
      piece(task, 'hosted', { kind: 'screenshot', uri: 'https://github.com/user-attachments/assets/h' }),
    ];
    const description = await new PullRequestDescriptions(store).describe(
      createRepo({ path: createTempDir() }),
      task,
      evidence
    );
    const encoded = /#review=([\w-]+)\)/.exec(description.body)?.[1] ?? '';
    const payload = parseReviewPayload(
      JSON.parse(inflateRawSync(Buffer.from(encoded, 'base64url')).toString())
    );
    expect(payload?.task).toMatchObject({ id: task.id, handle: 'LOC-28', summary: 'Did it.' });
    expect(payload?.evidence.map((part) => part.url)).toEqual([
      'https://github.com/user-attachments/assets/h',
    ]);
    expect(serializeReviewLink({ ...task, summary: randomBytes(40_000).toString('hex') }, [])).toBeNull();
  });
});
