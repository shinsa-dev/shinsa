import { describe, expect, test } from 'bun:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ServiceSuggestion } from '@shinsa/core';
import type { QuickJson } from '../../src/agents/quick/index.ts';
import {
  parseRefinedEntries,
  REFINE_LIMITS,
  readFolderDigest,
  resolveRefinedSuggestions,
  ServiceRefiner,
} from '../../src/terminals/refine.ts';
import { createTempDir } from '../helpers/index.ts';

function suggest(name: string, cwd: string, command = 'bun run dev'): ServiceSuggestion {
  return { name, cwd, command, source: 'package', recommended: true, previewUrl: null, portVariable: 'PORT' };
}

function entry(index: number, fields: Partial<Record<string, unknown>> = {}) {
  return {
    index,
    name: 'web',
    command: 'bun run dev --port $PORT',
    previewUrl: 'http://localhost:{port}',
    portVariable: '',
    recommended: true,
    ...fields,
  };
}

function createAsk(answers: unknown[]) {
  const calls: { system: string; prompt: string; schema: unknown }[] = [];
  const ask = ((system: string, prompt: string, schema?: unknown) => {
    calls.push({ system, prompt, schema });
    return Promise.resolve(answers.shift() ?? null);
  }) as QuickJson;
  return { ask, calls };
}

function createProject() {
  const root = createTempDir();
  mkdirSync(join(root, 'apps/web'), { recursive: true });
  writeFileSync(
    join(root, 'apps/web/package.json'),
    JSON.stringify({
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: { react: '19' },
      devDependencies: { vite: '7' },
    })
  );
  return { root, web: join(root, 'apps/web') };
}

describe('reading a folder for the refiner', () => {
  test('gives its scripts and dependency names, capped', () => {
    const { root, web } = createProject();
    expect(readFolderDigest(web)).toEqual({
      folder: web,
      scripts: { dev: 'vite', build: 'vite build' },
      dependencies: ['react', 'vite'],
    });
    expect(readFolderDigest(root)).toEqual({ folder: root, scripts: {}, dependencies: [] });
    const long = createTempDir();
    const scripts = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`s${i}`, 'x'.repeat(500)]));
    writeFileSync(join(long, 'package.json'), JSON.stringify({ scripts, dependencies: [1, 2] }));
    const digest = readFolderDigest(long);
    expect(Object.keys(digest.scripts)).toHaveLength(REFINE_LIMITS.scripts);
    expect(digest.scripts.s0).toHaveLength(REFINE_LIMITS.script);
    writeFileSync(join(long, 'package.json'), '[]');
    expect(readFolderDigest(long).scripts).toEqual({});
  });
});

describe('parsing the refiner’s answer', () => {
  test('keeps well-formed entries and refuses an answer without a list', () => {
    expect(parseRefinedEntries({ services: [entry(0), { index: 1.5 }, null, entry(2)] })).toEqual([
      entry(0),
      entry(2),
    ] as never);
    expect(parseRefinedEntries({ services: 'web' })).toBeNull();
    expect(parseRefinedEntries(null)).toBeNull();
  });
});

describe('applying the refiner’s answer to the detected services', () => {
  test('takes its names, commands, preview URL, port variable and recommendation', () => {
    const [web, ui] = [suggest('app', '/shop/apps/web'), suggest('ui', '/shop/packages/ui')];
    expect(
      resolveRefinedSuggestions(
        [web, ui],
        [entry(0, { portVariable: 'WEB_PORT' }), entry(1, { name: 'ui', previewUrl: '', recommended: false })]
      )
    ).toEqual([
      {
        ...web,
        name: 'web',
        command: 'bun run dev --port $PORT',
        previewUrl: 'http://localhost:{port}',
        portVariable: 'WEB_PORT',
      },
      { ...ui, command: 'bun run dev --port $PORT', recommended: false },
    ]);
  });

  test('keeps a candidate it left out, and the detected value for anything invalid', () => {
    const [web, api] = [suggest('web', '/shop/apps/web'), suggest('api', '/shop/apps/api')];
    expect(
      resolveRefinedSuggestions(
        [web, api],
        [
          entry(0, {
            name: ' ',
            command: 'x'.repeat(5000),
            previewUrl: 'http://localhost:3000',
            portVariable: '1PORT',
          }),
          entry(7),
        ]
      )
    ).toEqual([{ ...web, previewUrl: null }, api]);
  });

  test('never gives two services one name', () => {
    const candidates = [suggest('x', '/a'), suggest('y', '/b'), suggest('z', '/c')];
    const names = (entries: ReturnType<typeof entry>[]) =>
      resolveRefinedSuggestions(candidates, entries).map((each) => each.name);
    expect(names([entry(0, { name: 'web' }), entry(1, { name: 'WEB' })])).toEqual(['web', 'y', 'z']);
    expect(names([entry(0, { name: 'y' }), entry(1, { name: 'y' })])).toEqual(['y', 'y-2', 'z']);
    expect(names([entry(0, { name: 'z' }), entry(1, { name: 'z-3' }), entry(2, { name: 'z' })])).toEqual([
      'z',
      'z-3',
      'z-3-2',
    ]);
  });
});

describe('the service refiner', () => {
  test('asks once with the candidates and their folders, and answers again from its cache', async () => {
    const { web } = createProject();
    const { ask, calls } = createAsk([{ services: [entry(0)] }]);
    const refiner = new ServiceRefiner(ask);
    const candidates = [suggest('app', web)];
    const first = await refiner.refine('p1', candidates);
    expect(first).toEqual({
      refined: true,
      suggestions: [
        {
          ...candidates[0],
          name: 'web',
          command: 'bun run dev --port $PORT',
          previewUrl: 'http://localhost:{port}',
        } as ServiceSuggestion,
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.system).toContain('Vite and Vite-based tools need `--port $PORT`');
    expect(JSON.parse(calls[0]?.prompt ?? '')).toEqual({
      candidates: [{ index: 0, name: 'app', folder: web, command: 'bun run dev', source: 'package' }],
      folders: [
        { folder: web, scripts: { dev: 'vite', build: 'vite build' }, dependencies: ['react', 'vite'] },
      ],
    });
    expect(await refiner.refine('p1', candidates)).toEqual(first);
    expect(calls).toHaveLength(1);
  });

  test('asks again once the files or the candidates change', async () => {
    const { web } = createProject();
    const { ask, calls } = createAsk([{ services: [] }, { services: [] }, { services: [] }]);
    const refiner = new ServiceRefiner(ask);
    await refiner.refine('p1', [suggest('web', web)]);
    writeFileSync(join(web, 'package.json'), JSON.stringify({ scripts: { dev: 'next dev' } }));
    await refiner.refine('p1', [suggest('web', web)]);
    await refiner.refine('p1', [suggest('web', web, 'npm run dev')]);
    expect(calls).toHaveLength(3);
  });

  test('falls back to the detected services when the call fails, and tries again next time', async () => {
    const { web } = createProject();
    const { ask, calls } = createAsk([null, { services: 'nothing' }]);
    const refiner = new ServiceRefiner(ask);
    const candidates = [suggest('web', web)];
    expect(await refiner.refine('p1', candidates)).toEqual({ suggestions: candidates, refined: false });
    expect(await refiner.refine('p1', candidates)).toEqual({ suggestions: candidates, refined: false });
    expect(calls).toHaveLength(2);
  });

  test('asks nothing when there is nothing to refine', async () => {
    const { ask, calls } = createAsk([]);
    expect(await new ServiceRefiner(ask).refine('p1', [])).toEqual({ suggestions: [], refined: false });
    expect(calls).toHaveLength(0);
  });

  test('shares one call between two requests that arrive together', async () => {
    const { web } = createProject();
    const { ask, calls } = createAsk([{ services: [entry(0)] }]);
    const refiner = new ServiceRefiner(ask);
    const candidates = [suggest('app', web)];
    const [one, two] = await Promise.all([
      refiner.refine('p1', candidates),
      refiner.refine('p1', candidates),
    ]);
    expect(one).toEqual(two);
    expect(calls).toHaveLength(1);
  });
});
