import { afterEach, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ModelSource } from '../../src/agents/index.ts';
import { Transcripts } from '../../src/agents/index.ts';
import type { QuickJson } from '../../src/agents/quick/index.ts';
import { type CliIo, runCli } from '../../src/cli/index.ts';
import { startServer } from '../../src/http/index.ts';
import { runCommandOrThrow } from '../../src/shell/index.ts';
import { EvidenceStore } from '../../src/store/index.ts';
import { createTestOnboarding, createTestTerminal } from '../helpers/index.ts';
import { World } from './harness.ts';

setDefaultTimeout(30_000);

let world: World | null = null;

const stops: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  await world?.dispose();
  world = null;
});

async function open() {
  world = await World.create();
  const w = world;
  const { onboarding, roots } = createTestOnboarding(w.engine, w.config);
  const http = startServer({
    engine: w.engine,
    config: w.config,
    transcripts: new Transcripts(w.config.transcriptsDir),
    evidence: new EvidenceStore(w.config.evidenceDir),
    models: { listModels: () => Promise.resolve([]) } as unknown as ModelSource,
    onboarding,
    roots,
    resolveLogin: () => Promise.resolve(null),
  });
  stops.push(http.stop);
  const port = String(http.server.port);
  const shinsa = async (...args: string[]) => {
    const out: string[] = [];
    const io: CliIo = {
      env: { SHINSA_PORT: port, SHINSA_HOME: w.config.home },
      cwd: w.root,
      write: (line = '') => out.push(line),
      writeError: (line) => out.push(line),
      openApp: () => Promise.resolve(),
      readRepoRoot: () => Promise.resolve(null),
      wakeEngine: () => Promise.resolve(false),
      engine: {
        bundled: false,
        uid: 0,
        ownsJob: () => true,
        launchctl: () => Promise.resolve({ ok: false, output: '' }),
      },
      runEngine: () => Promise.reject(new Error('not in this test')),
      onShutdown: () => undefined,
      terminal: createTestTerminal(),
    };
    const code = await runCli(args, io);
    return { code, text: out.join('\n') };
  };
  return { w, shinsa };
}

async function createRepo(path: string) {
  mkdirSync(path, { recursive: true });
  await runCommandOrThrow(['git', 'init', '-q', '-b', 'main'], path);
  writeFileSync(join(path, 'README.md'), '# repo\n');
  await runCommandOrThrow(['git', 'add', '-A'], path);
  await runCommandOrThrow(['git', 'commit', '-q', '-m', 'chore: start'], path);
  return realpathSync(path);
}

function newTaskId(w: World, before: Set<string>) {
  return Object.keys(w.state.tasks).find((id) => !before.has(id)) ?? '';
}

describe('projects', () => {
  test('a task created in a project gets a fresh run told the project, its description and its repositories', async () => {
    const { w, shinsa } = await open();
    const repoPath = realpathSync(w.repoPath);
    const written = await shinsa(
      'projects',
      'write',
      '--name',
      'Greeter',
      '--key',
      'GR',
      '--description',
      'The greeting app and its files.'
    );
    expect(written.code).toBe(0);
    expect((await shinsa('projects', 'add-repo', 'gr', repoPath)).text).toBe(
      'Added the repository to Greeter.'
    );
    expect((await shinsa('projects', 'show', 'GR')).text).toBe(
      ['Greeter (GR)', 'The greeting app and its files.', '', 'Repositories:', `  app  ${repoPath}`].join(
        '\n'
      )
    );

    w.classify = <T>() =>
      Promise.resolve({
        title: 'Add the greeting files',
        repo: 'app',
        size: 'small',
        branch: 'feat/greeting',
      } as T);
    const before = new Set(Object.keys(w.state.tasks));
    expect((await shinsa('tasks', 'create', 'Add the greeting files', '--project', 'Greeter')).code).toBe(0);
    const taskId = newTaskId(w, before);
    expect(w.task(taskId).handle).toBe('GR-1');
    await w.until('the first agent', () => w.agents.sessions.length > 0);

    const chat = await shinsa('tasks', 'chat', 'gr-1', '--kinds', 'user');
    expect(chat.code).toBe(0);
    expect(chat.text).toContain('This task belongs to the project Greeter (tasks GR-1, GR-2 and so on).');
    expect(chat.text).toContain('About the project: The greeting app and its files.');
    expect(chat.text).toContain(`Its repositories:\n- app: ${repoPath} (this task works here)`);
    expect((await shinsa('tasks', 'show', 'GR-1')).text).toContain('Add the greeting files');
  });

  test('triage picks one of the project’s repositories, lists each with its path, and files it in the project', async () => {
    const { w, shinsa } = await open();
    const folder = join(w.root, 'basket');
    const ios = await createRepo(join(folder, 'ios-sdk'));
    const server = await createRepo(join(folder, 'server'));
    expect(
      (
        await shinsa(
          'projects',
          'write',
          '--name',
          'Basket',
          '--description',
          'A shopping app: an iOS SDK and its server.'
        )
      ).code
    ).toBe(0);
    expect((await shinsa('projects', 'add-folder', 'basket', folder)).text).toBe(
      'Added the folder to Basket.'
    );
    const project = Object.values(w.state.projects).find((candidate) => candidate.name === 'Basket');
    expect(project?.folders).toEqual([realpathSync(folder)]);

    const prompts: string[] = [];
    const classify: QuickJson = <T>(_system: string, prompt: string) => {
      prompts.push(prompt);
      return Promise.resolve({
        title: 'Return 404 for an unknown basket',
        repo: 'server',
        size: 'small',
        branch: 'fix/unknown-basket',
        waits_on: [],
      } as T);
    };
    w.classify = classify;
    const before = new Set(Object.keys(w.state.tasks));
    expect(
      (await shinsa('tasks', 'create', 'The basket endpoint crashes on an unknown id', '--project', 'BAS'))
        .code
    ).toBe(0);
    const taskId = newTaskId(w, before);
    await w.until('triage to pick a repository', () => w.task(taskId).repoId !== null);

    expect(prompts[0]).toContain(
      'Project:\n- name: Basket\n- key: BAS\n- description: A shopping app: an iOS SDK and its server.\n'
    );
    expect(prompts[0]).toContain('Repositories:\n');
    expect(prompts[0]).toContain(`- ios-sdk: ${ios}`);
    expect(prompts[0]).toContain(`- server: ${server}`);
    expect(prompts[0]).not.toContain(`- app: ${realpathSync(w.repoPath)}`);

    const repo = w.state.repos[w.task(taskId).repoId ?? ''];
    expect(repo).toMatchObject({ name: 'server', path: server, projectId: project?.id });
    expect(w.task(taskId)).toMatchObject({ handle: 'BAS-1', title: 'Return 404 for an unknown basket' });
    expect((await shinsa('projects', 'show', 'Basket')).text).toContain(`Repositories:\n  server  ${server}`);
  });
});
