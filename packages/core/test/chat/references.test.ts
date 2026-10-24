import { describe, expect, test } from 'bun:test';
import {
  linkReferences,
  listReferenceSpans,
  markInlineCode,
  parseReference,
  type ReferenceCatalog,
  resolveReferenceCatalog,
  serializeReference,
  serializeTaskReferences,
} from '../../src/index.ts';
import { createHarness, createTask, pullRequest, reachShipping } from '../harness.ts';

const CATALOG: ReferenceCatalog = {
  tasks: [
    { id: 'task-chat', title: 'Run the embedded chat on MCP v2' },
    { id: 'task-tools', title: 'Let the embedded chat call paywall tools' },
    { id: 'task-short', title: 'Fix login' },
  ],
  pullRequests: [
    { number: 4531, repo: 'paywall-next', taskId: 'task-chat' },
    { number: 12, repo: 'paywall-next', taskId: 'task-tools' },
    { number: 12, repo: 'docs', taskId: 'task-short' },
  ],
};

describe('parseReference', () => {
  test('reads every entity', () => {
    expect(parseReference('shinsa://task/task-chat')).toEqual({ kind: 'task', id: 'task-chat' });
    expect(parseReference('shinsa://pr/paywall-next#4531')).toEqual({
      kind: 'pr',
      repo: 'paywall-next',
      number: 4531,
    });
    expect(parseReference('shinsa://pr/superwall/paywall-next/7')).toEqual({
      kind: 'pr',
      repo: 'superwall/paywall-next',
      number: 7,
    });
    expect(parseReference('shinsa://pr/88')).toEqual({ kind: 'pr', repo: null, number: 88 });
    expect(parseReference('shinsa://repo/paywall-next')).toEqual({ kind: 'repo', name: 'paywall-next' });
    expect(parseReference('shinsa://branch/feat/embedded-chat')).toEqual({
      kind: 'branch',
      name: 'feat/embedded-chat',
    });
    expect(parseReference('shinsa://file/src/chat/session.ts#L12-L20')).toEqual({
      kind: 'file',
      path: 'src/chat/session.ts',
      line: 12,
      end: 20,
    });
    expect(parseReference('SHINSA://Task/abc')).toEqual({ kind: 'task', id: 'abc' });
  });

  test('refuses anything malformed', () => {
    for (const href of [
      'https://github.com',
      'shinsa://',
      'shinsa://task/',
      'shinsa://task/a b',
      'shinsa://unknown/x',
      'shinsa://pr/paywall#abc',
      'shinsa://pr/0',
      'shinsa://file/../etc/passwd',
      'shinsa://file/src/a.ts#middle',
      'shinsa://branch/a..b',
    ]) {
      expect(parseReference(href)).toBeNull();
    }
  });

  test('round-trips through serializeReference', () => {
    for (const href of [
      'shinsa://task/task-chat',
      'shinsa://pr/paywall-next#4531',
      'shinsa://pr/9',
      'shinsa://repo/docs',
      'shinsa://branch/fix/a',
      'shinsa://file/src/a.ts',
      'shinsa://file/src/a.ts#L3',
      'shinsa://file/src/a.ts#L3-L9',
    ]) {
      const reference = parseReference(href);
      expect(reference).not.toBeNull();
      if (reference) expect(serializeReference(reference)).toBe(href);
    }
  });
});

describe('listReferenceSpans', () => {
  test('finds explicit links and bare urls', () => {
    const spans = listReferenceSpans(
      'See [the chat](shinsa://task/task-chat) and shinsa://file/src/a.ts#L4.',
      CATALOG
    );
    expect(spans.map((span) => [span.source, span.label, serializeReference(span.reference)])).toEqual([
      ['link', 'the chat', 'shinsa://task/task-chat'],
      ['url', '', 'shinsa://file/src/a.ts#L4'],
    ]);
  });

  test('detects quoted titles, long bare titles and unambiguous pull request numbers', () => {
    const text =
      'Review "fix login" first. Run the embedded chat on MCP v2 is blocked, #4531 is green, #12 is ambiguous.';
    const spans = listReferenceSpans(text, CATALOG);
    expect(spans.map((span) => [span.source, text.slice(span.start, span.end)])).toEqual([
      ['quoted', '"fix login"'],
      ['title', 'Run the embedded chat on MCP v2'],
      ['number', '#4531'],
    ]);
  });

  test('leaves short bare titles, code, excluded tasks and links alone', () => {
    const text =
      'Fix login. `Run the embedded chat on MCP v2` and [Let the embedded chat call paywall tools](https://x.dev) #4531abc';
    expect(listReferenceSpans(text, CATALOG)).toEqual([]);
    expect(
      listReferenceSpans('Run the embedded chat on MCP v2', CATALOG, { exclude: new Set(['task-chat']) })
    ).toEqual([]);
    expect(listReferenceSpans('#4531', CATALOG, { numbers: false })).toEqual([]);
  });
});

describe('linkReferences', () => {
  test('turns detected mentions into reference links and keeps explicit ones', () => {
    expect(linkReferences('After "Fix login", merge #4531 and read [x](shinsa://repo/docs).', CATALOG)).toBe(
      'After [Fix login](shinsa://task/task-short), merge [#4531](shinsa://pr/paywall-next#4531) and read [x](shinsa://repo/docs).'
    );
  });

  test('survives markInlineCode', () => {
    const linked = linkReferences('See shinsa://file/src/chat/mcpSession.ts#L15 now', CATALOG);
    expect(markInlineCode(linked)).toBe(linked);
  });
});

describe('find_tasks', () => {
  test('lists tasks as ready reference links with their handles and builds the catalog', () => {
    const harness = createHarness();
    const api = createTask(harness, { request: 'Ship the API' });
    createTask(harness, { request: 'Polish the docs' });
    expect(serializeTaskReferences(harness.state, 'api')).toBe(
      `- SUP-1 [Ship the API](shinsa://task/${api}) · planning · repository paywall-next · branch fix/${api}`
    );
    expect(serializeTaskReferences(harness.state, 'sup-2')).toStartWith('- SUP-2 [Polish the docs](');
    expect(serializeTaskReferences(harness.state, '').split('\n')).toHaveLength(2);
    expect(serializeTaskReferences(harness.state, 'nothing like this')).toBe(
      'No task matches. Try fewer words.'
    );
    harness.send({ type: 'task.create', request: 'No handle yet', repoId: null, projectId: null });
    expect(serializeTaskReferences(harness.state, 'handle yet')).toStartWith('- [No handle yet](');
    expect(resolveReferenceCatalog(harness.state).tasks.map((task) => task.title)).toEqual([
      'Ship the API',
      'Polish the docs',
      'No handle yet',
    ]);
  });
});

describe('find_tasks with pull requests', () => {
  test('links the pull request of a shipped task, finds it by number, and leaves cancelled tasks out', () => {
    const harness = createHarness();
    const api = createTask(harness, { request: 'Ship the API' });
    reachShipping(harness, api);
    harness.send({
      type: 'pull_request.record',
      taskId: api,
      pullRequest: pullRequest({ checks: 'pending' }),
    });
    const gone = createTask(harness, { request: 'Ship the old API' });
    harness.send({ type: 'task.cancel', taskId: gone });
    expect(serializeTaskReferences(harness.state, '#42')).toBe(
      `- SUP-1 [Ship the API](shinsa://task/${api}) · pull request open · repository paywall-next · branch fix/${api} · [#42](shinsa://pr/paywall-next#42) open`
    );
    expect(resolveReferenceCatalog(harness.state)).toEqual({
      tasks: [{ id: api, title: 'Ship the API' }],
      pullRequests: [{ number: 42, repo: 'paywall-next', taskId: api }],
    });
  });

  test('a task without a repository has no repository in its pull request link', () => {
    const harness = createHarness();
    const api = createTask(harness, { request: 'Ship the API' });
    harness.send({ type: 'pull_request.record', taskId: api, pullRequest: pullRequest() });
    harness.send({ type: 'repo.remove', repoId: harness.task(api).repoId ?? '' });
    expect(resolveReferenceCatalog(harness.state).pullRequests).toEqual([
      { number: 42, repo: null, taskId: api },
    ]);
    expect(serializeTaskReferences(harness.state, 'api')).toContain('[#42](shinsa://pr/42) open');
  });
});

describe('parseReference edge cases', () => {
  test('keeps a part that is not valid percent-encoding as it is', () => {
    expect(parseReference('shinsa://file/src/100%.ts')).toEqual({
      kind: 'file',
      path: 'src/100%.ts',
      line: null,
      end: null,
    });
  });
});
