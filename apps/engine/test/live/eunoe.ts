import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ChatEvent, CompactionMode } from '@shinsa/core';
import { startClaudeSession } from '../../src/agents/providers/claude/session.ts';
import type { AgentSessionResult } from '../../src/agents/providers/index.ts';
import { createShinsaTools } from '../../src/agents/tools/index.ts';
import { EunoeServer } from '../../src/eunoe/index.ts';

const MARKERS = ['amber', 'basalt', 'cobalt', 'dahlia'];

const MODEL = Bun.env.SHINSA_LIVE_MODEL ?? 'opus';

interface Turn {
  label: string;
  sessionId: string | null;
  result: AgentSessionResult;
  entries: ChatEvent[];
  requests: Record<string, unknown>[];
}

interface Check {
  name: string;
  passed: boolean;
  detail: string;
}

const checks: Check[] = [];

function print(...parts: unknown[]) {
  process.stdout.write(`${parts.map(String).join(' ')}\n`);
}

function check(name: string, passed: boolean, detail: string) {
  checks.push({ name, passed, detail });
  print(passed ? 'PASS' : 'FAIL', name, '·', detail);
}

function writeHaystack(dir: string) {
  const lines = Array.from(
    { length: 4_000 },
    (_, index) => `line ${index + 1}: ${'filler '.repeat(6).trim()}`
  );
  MARKERS.forEach((word, index) => {
    lines[700 + index * 900] = `MARKER ${index + 1}: ${word}`;
  });
  writeFileSync(join(dir, 'haystack.txt'), `${lines.join('\n')}\n`);
}

function readRequests(dir: string) {
  try {
    return readFileSync(join(dir, 'requests.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

function listActions(request: Record<string, unknown>) {
  return Array.isArray(request.actions) ? (request.actions as string[]) : [];
}

function readNumber(request: Record<string, unknown> | undefined, key: string) {
  const value = request?.[key];
  return typeof value === 'number' ? value : 0;
}

interface TurnOptions {
  label: string;
  cwd: string;
  eunoeDir: string;
  server: EunoeServer;
  prompt: string;
  resume?: string | null;
  fold?: boolean;
  compaction?: CompactionMode;
}

async function runTurn(options: TurnOptions): Promise<Turn> {
  const entries: ChatEvent[] = [];
  let sessionId: string | null = options.resume ?? null;
  const before = readRequests(options.eunoeDir).length;
  const started = Date.now();
  const session = startClaudeSession(
    {
      role: 'agent',
      readOnly: false,
      cwd: options.cwd,
      prompt: options.prompt,
      model: MODEL,
      resume: options.resume ?? null,
      defaultBranch: 'main',
      tools: createShinsaTools('agent', () => Promise.resolve('ok')),
      pluginDir: resolve(import.meta.dirname, '../../plugin'),
      compaction: options.compaction ?? 'fold',
      ...(options.fold ? { fold: true } : {}),
      onSession: (id) => {
        sessionId = id;
      },
      onEntry: (entry) => entries.push(entry),
    },
    { eunoe: options.server }
  );
  const result = await session.done;
  const requests = readRequests(options.eunoeDir).slice(before);
  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  print(
    `\n=== ${options.label} (${seconds}s) ===`,
    `outcome ${result.outcome}`,
    `requests ${requests.length}`,
    `failure ${result.failure?.code ?? 'none'}`
  );
  for (const request of requests) {
    print(
      '  ',
      request.path,
      request.status,
      `action=${String(request.action)}`,
      `actions=${listActions(request).join(',') || '-'}`,
      `input=${readNumber(request, 'input')}`,
      `cacheRead=${readNumber(request, 'cacheRead')}`,
      `cacheWrite=${readNumber(request, 'cacheWrite')}`,
      request.error ? `error=${String(request.error).slice(0, 160)}` : ''
    );
  }
  return { label: options.label, sessionId, result, entries, requests };
}

function listNoticeKinds(turn: Turn) {
  return turn.entries.flatMap((entry) => (entry.type === 'notice' ? [entry.notice.kind] : []));
}

function isMessagesRequest(request: Record<string, unknown>) {
  return request.path === '/v1/messages';
}

async function runFoldScenario(root: string) {
  const cwd = join(root, 'fold');
  const eunoeDir = join(root, 'fold-eunoe');
  mkdirSync(cwd, { recursive: true });
  writeHaystack(cwd);
  const server = new EunoeServer({ dir: eunoeDir });
  try {
    const plan = await runTurn({
      label: 'fold 1 · plan turn reads a large file',
      cwd,
      eunoeDir,
      server,
      prompt:
        'Run `cat haystack.txt` with the Bash tool and read its whole output (no head, tail or grep). It holds four lines that start with MARKER. Reply with only the four marker words, in order, separated by spaces.',
    });
    const words = MARKERS.join(' ');
    const reply = plan.result.summary ?? '';
    check('plan turn completes', plan.result.outcome === 'completed', `outcome ${plan.result.outcome}`);
    check(
      'plan turn finds the markers',
      MARKERS.every((word) => reply.includes(word)),
      `reply "${reply}"`
    );
    check(
      'plan turn goes through the forwarder',
      plan.requests.some(isMessagesRequest) && plan.requests.every((request) => request.status === 200),
      `${plan.requests.length} requests, statuses ${[...new Set(plan.requests.map((r) => r.status))].join(',')}`
    );

    const build = await runTurn({
      label: 'fold 2 · build turn folds the plan turn',
      cwd,
      eunoeDir,
      server,
      resume: plan.sessionId,
      fold: true,
      prompt: [
        'The human approved the plan. The plan: write the marker words from the earlier turn into notes.txt.',
        `The earlier turn reported these marker words: ${words}.`,
        'Now build phase 1 of 1: create notes.txt with the four marker words, one per line, in order. Reply with only DONE.',
      ].join('\n'),
    });
    const first = build.requests.find(isMessagesRequest);
    const notes = (() => {
      try {
        return readFileSync(join(cwd, 'notes.txt'), 'utf8').trim().split('\n');
      } catch {
        return [];
      }
    })();
    check('build turn completes', build.result.outcome === 'completed', `outcome ${build.result.outcome}`);
    check('build turn resumes the same session', build.sessionId === plan.sessionId, `${build.sessionId}`);
    check(
      'the first build request carries the fold',
      first !== undefined && listActions(first).includes('fold'),
      `actions ${first ? listActions(first).join(',') : 'none'}`
    );
    check(
      'only the first build request folds',
      build.requests.filter((request) => listActions(request).includes('fold')).length === 1,
      `${build.requests.filter((request) => listActions(request).includes('fold')).length} folds`
    );
    check(
      'the API accepts every folded request',
      build.requests.every((request) => request.status === 200),
      `statuses ${[...new Set(build.requests.map((request) => request.status))].join(',')}`
    );
    const lastPlan = plan.requests.filter(isMessagesRequest).at(-1);
    check(
      'the folded request is much smaller than the plan turn’s last',
      readNumber(first, 'input') > 0 && readNumber(first, 'input') < readNumber(lastPlan, 'input') * 0.6,
      `build first ${readNumber(first, 'input')} vs plan last ${readNumber(lastPlan, 'input')}`
    );
    check(
      'a fold notice reaches the chat',
      listNoticeKinds(build).includes('compaction'),
      listNoticeKinds(build).join(',')
    );
    check('the build did its work', notes.join(' ') === words, `notes.txt "${notes.join(' ')}"`);

    const later = build.requests.filter(isMessagesRequest).slice(1);
    check(
      'the build turn’s later requests read the folded prefix from the cache',
      later.length === 0 || later.every((request) => readNumber(request, 'cacheRead') > 0),
      later.map((request) => readNumber(request, 'cacheRead')).join(',') || 'single request'
    );

    const follow = await runTurn({
      label: 'fold 3 · next turn without a fold keeps the cache',
      cwd,
      eunoeDir,
      server,
      resume: build.sessionId,
      prompt: 'Reply with only the number of lines in notes.txt. Do not run any tool.',
    });
    const followFirst = follow.requests.find(isMessagesRequest);
    check('follow-up completes', follow.result.outcome === 'completed', `reply "${follow.result.summary}"`);
    check(
      'the follow-up does not fold again',
      follow.requests.every((request) => !listActions(request).includes('fold')),
      follow.requests.map((request) => listActions(request).join('+') || '-').join(',')
    );
    check(
      'the follow-up reads most of its prompt from the cache',
      readNumber(followFirst, 'cacheRead') > readNumber(followFirst, 'input') * 0.5,
      `cacheRead ${readNumber(followFirst, 'cacheRead')} of input ${readNumber(followFirst, 'input')}`
    );
    return [plan, build, follow];
  } finally {
    await server.stop();
  }
}

async function runCutScenario(root: string) {
  const cwd = join(root, 'cut');
  const eunoeDir = join(root, 'cut-eunoe');
  mkdirSync(cwd, { recursive: true });
  writeHaystack(cwd);
  const server = new EunoeServer({ dir: eunoeDir, window: () => Promise.resolve(90_000) });
  try {
    const first = await runTurn({
      label: 'cut 1 · read the file in a small window',
      cwd,
      eunoeDir,
      server,
      compaction: 'compact',
      prompt:
        'Run `cat haystack.txt` with the Bash tool and read its whole output (no head, tail or grep). Reply with only the four MARKER words.',
    });
    const second = await runTurn({
      label: 'cut 2 · read it again, past the limit',
      cwd,
      eunoeDir,
      server,
      compaction: 'compact',
      resume: first.sessionId,
      prompt:
        'Run `cat haystack.txt` with the Bash tool again and read its whole output. Then reply with only the line number of MARKER 3.',
    });
    const cut = second.requests.some((request) => listActions(request).includes('cut'));
    check('compaction only cuts near a small window', cut, `${second.requests.length} requests`);
    check(
      'the API accepts every cut request',
      [...first.requests, ...second.requests].every((request) => request.status === 200),
      `statuses ${[...new Set([...first.requests, ...second.requests].map((request) => request.status))].join(',')}`
    );
    check(
      'compaction only never folds at the turn boundary',
      second.requests.every((request) => !listActions(request).includes('fold')),
      second.requests.map((request) => listActions(request).join('+') || '-').join(',')
    );
    check(
      'the cut turn still completes',
      second.result.outcome === 'completed',
      `reply "${second.result.summary}"`
    );
    return [first, second];
  } finally {
    await server.stop();
  }
}

async function runStuckScenario(root: string) {
  const cwd = join(root, 'stuck');
  const eunoeDir = join(root, 'stuck-eunoe');
  mkdirSync(cwd, { recursive: true });
  writeHaystack(cwd);
  const server = new EunoeServer({ dir: eunoeDir, window: () => Promise.resolve(30_000) });
  try {
    const stuck = await runTurn({
      label: 'stuck · one turn bigger than the window',
      cwd,
      eunoeDir,
      server,
      prompt:
        'Run `cat haystack.txt` with the Bash tool, then run it a second time, then reply with only the four MARKER words.',
    });
    check(
      'a thread too big for its window ends the turn as context-full',
      stuck.result.outcome === 'failed' &&
        stuck.result.failure?.class === 'context_window_full' &&
        stuck.result.failure.code === 'eunoe_stuck',
      `outcome ${stuck.result.outcome}, failure ${stuck.result.failure?.class}/${stuck.result.failure?.code}`
    );
    const stuckRequests = stuck.requests.filter((request) => request.stuck);
    check(
      'no stuck request rewrites the whole cache again',
      stuckRequests.slice(1).every((request) => readNumber(request, 'cacheRead') > 0),
      stuckRequests
        .map((request) => `${readNumber(request, 'cacheRead')}/${readNumber(request, 'input')}`)
        .join(',') || 'stopped on the first stuck request'
    );
    return [stuck];
  } finally {
    await server.stop();
  }
}

const liveRoot = mkdtempSync(join(tmpdir(), 'shinsa-eunoe-live-'));
print('model', MODEL, 'folder', liveRoot);
const turns = [
  ...(await runFoldScenario(liveRoot)),
  ...(await runCutScenario(liveRoot)),
  ...(await runStuckScenario(liveRoot)),
];
const failed = checks.filter((item) => !item.passed);
const summary = {
  model: MODEL,
  folder: liveRoot,
  passed: checks.length - failed.length,
  failed: failed.length,
  checks,
  turns: turns.map((turn) => ({
    label: turn.label,
    outcome: turn.result.outcome,
    failure: turn.result.failure ?? null,
    usage: turn.result.usage ?? null,
    requests: turn.requests,
  })),
};
writeFileSync(join(liveRoot, 'summary.json'), JSON.stringify(summary, null, 2));
print(`\n${summary.passed} passed, ${summary.failed} failed · ${join(liveRoot, 'summary.json')}`);
process.exitCode = failed.length > 0 ? 1 : 0;
