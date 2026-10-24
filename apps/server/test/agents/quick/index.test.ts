import { describe, expect, test } from 'bun:test';
import { createSettings } from '@shinsa/core';
import { CLAUDE_CAPABILITIES } from '../../../src/agents/providers/claude/index.ts';
import {
  type AgentProvider,
  type CompletionRequest,
  ProviderRegistry,
  type StructuredRequest,
} from '../../../src/agents/providers/index.ts';
import {
  createQuickCalls,
  parseJsonObject,
  requestQuickStructured,
} from '../../../src/agents/quick/index.ts';
import { overrideEnv } from '../../helpers/index.ts';

function withQuickOn<T>(run: () => Promise<T>) {
  const restore = overrideEnv({ SHINSA_QUICK: undefined });
  return run().finally(restore);
}

interface FakeProvider {
  provider: AgentProvider;
  texts: CompletionRequest[];
  structured: StructuredRequest[];
}

function fakeProvider(
  id: string,
  answers: { text?: () => Promise<string | null>; structured?: () => Promise<unknown> }
): FakeProvider {
  const texts: CompletionRequest[] = [];
  const structured: StructuredRequest[] = [];
  const answerStructured = answers.structured;
  const provider: AgentProvider = {
    id,
    label: id.toUpperCase(),
    ...(answerStructured
      ? {
          capabilities: CLAUDE_CAPABILITIES,
          completeStructured: (request: StructuredRequest) => {
            structured.push(request);
            return answerStructured();
          },
        }
      : {}),
    startSession: () => {
      throw new Error('not used');
    },
    complete: (request) => {
      texts.push(request);
      return answers.text?.() ?? Promise.resolve(null);
    },
    listModels: () => Promise.resolve([]),
  };
  return { provider, texts, structured };
}

const SCHEMA = { type: 'object' as const, properties: { size: { type: 'string' } }, required: ['size'] };

function parseSize(value: unknown) {
  const size = (value as { size?: unknown }).size;
  return size === 'small' || size === 'large' ? size : null;
}

describe('requestQuickStructured', () => {
  test('is off when SHINSA_QUICK is off', async () => {
    const fake = fakeProvider('a', { text: () => Promise.resolve('{"size":"small"}') });
    const result = await requestQuickStructured(
      { task: 'sizing', system: 's', prompt: 'p', schema: SCHEMA, parse: parseSize, model: 'haiku' },
      [fake.provider]
    );
    expect(result).toEqual({ value: null, failures: [] });
    expect(fake.texts).toHaveLength(0);
  });

  test('asks for schema-checked output first, on the model asked for and with the timeout', async () => {
    const fake = fakeProvider('a', { structured: () => Promise.resolve({ size: 'large' }) });
    const result = await withQuickOn(() =>
      requestQuickStructured(
        {
          task: 'sizing',
          system: 's',
          prompt: 'p',
          schema: SCHEMA,
          parse: parseSize,
          model: 'sonnet',
          timeoutMs: 50,
        },
        [fake.provider]
      )
    );
    expect(result).toEqual({ value: 'large', failures: [] });
    expect(fake.structured).toEqual([
      { system: 's', prompt: 'p', model: 'sonnet', fastMode: false, schema: SCHEMA, timeoutMs: 50 },
    ]);
  });

  test('falls back to a text answer with the schema spelled out, then to the next provider, keeping every reason', async () => {
    const first = fakeProvider('a', {
      structured: () => Promise.reject(new Error('timed out')),
      text: () => Promise.resolve('{"size":"huge"}'),
    });
    const second = fakeProvider('b', { text: () => Promise.resolve(null) });
    const third = fakeProvider('c', {
      text: () => Promise.resolve('Sure:\n```json\n{"size": "small"}\n```'),
    });
    const result = await withQuickOn(() =>
      requestQuickStructured(
        { task: 'sizing', system: 'Size it.', prompt: 'p', schema: SCHEMA, parse: parseSize, model: 'haiku' },
        [first.provider, second.provider, third.provider]
      )
    );
    expect(result).toEqual({
      value: 'small',
      failures: [
        { provider: 'a', mode: 'structured', reason: 'A failed sizing: timed out' },
        { provider: 'a', mode: 'text', reason: 'A returned invalid output for sizing.' },
        { provider: 'b', mode: 'text', reason: 'B returned no result for sizing.' },
      ],
    });
    expect(first.texts[0]?.system).toBe(
      `Size it.\nAnswer with one JSON object and nothing else.\nIt must match this JSON schema:\n${JSON.stringify(SCHEMA)}`
    );
  });

  test('when every provider fails the caller gets nothing and the reasons', async () => {
    const broken = fakeProvider('a', { text: () => Promise.reject(new Error('down')) });
    const result = await withQuickOn(() =>
      requestQuickStructured(
        { task: 'sizing', system: 's', prompt: 'p', schema: null, parse: parseSize, model: 'haiku' },
        [broken.provider]
      )
    );
    expect(result).toEqual({
      value: null,
      failures: [{ provider: 'a', mode: 'text', reason: 'A failed sizing: down' }],
    });
  });
});

describe('createQuickCalls', () => {
  test('returns the first JSON object, without a schema told to answer JSON only', async () => {
    const fake = fakeProvider('claude', { text: () => Promise.resolve('Sure: {"a": 1} done') });
    const quick = createQuickCalls(new ProviderRegistry([fake.provider]), createSettings);
    expect(await withQuickOn(() => quick.classify('Route it.', 'p'))).toEqual({ a: 1 });
    expect(fake.texts[0]?.system).toBe('Route it.\nAnswer with one JSON object and nothing else.');
    const listy = fakeProvider('claude', { text: () => Promise.resolve('[1, 2]') });
    const lists = createQuickCalls(new ProviderRegistry([listy.provider]), createSettings);
    expect(await withQuickOn(() => lists.classify('s', 'p'))).toBeNull();
  });

  test('fast mode follows the setting, and only reaches a provider that can run fast', async () => {
    const claude = fakeProvider('claude', {
      structured: () => Promise.reject(new Error('signed out')),
      text: () => Promise.reject(new Error('signed out')),
    });
    const plain = fakeProvider('plain', { text: () => Promise.resolve('{"from": "plain"}') });
    const registry = new ProviderRegistry([claude.provider, plain.provider]);
    const fast = createQuickCalls(registry, () => ({ ...createSettings(), fastMode: true }));
    expect(await withQuickOn(() => fast.classify('s', 'p', SCHEMA))).toEqual({ from: 'plain' });
    expect(claude.structured[0]?.fastMode).toBe(true);
    expect(claude.texts[0]?.fastMode).toBe(true);
    expect(plain.texts[0]?.fastMode).toBe(false);
    const standard = createQuickCalls(registry, createSettings);
    await withQuickOn(() => standard.classify('s', 'p', SCHEMA));
    expect(claude.structured[1]?.fastMode).toBe(false);
  });

  test('fast mode is asked of the provider first, and runs only where the account has usage credits', async () => {
    const fake = fakeProvider('claude', { structured: () => Promise.resolve({ ok: true }) });
    const answers = ['needs_credits', 'available'] as const;
    const asked: string[] = [];
    const quick = createQuickCalls(
      new ProviderRegistry([fake.provider]),
      () => ({ ...createSettings(), fastMode: true }),
      (provider) => {
        asked.push(provider);
        return Promise.resolve(answers[asked.length - 1] ?? 'unknown');
      }
    );
    await withQuickOn(() => quick.classify('s', 'p', SCHEMA));
    await withQuickOn(() => quick.write('s', 'p', SCHEMA));
    expect(asked).toEqual(['claude', 'claude']);
    expect(fake.structured.map((request) => request.fastMode)).toEqual([false, true]);
  });

  test('the classifier and the writer each run at the speed set for their own role', async () => {
    const fake = fakeProvider('claude', { structured: () => Promise.resolve({ ok: true }) });
    const settings = { ...createSettings(), fastMode: true, agentFastModes: { classifier: false } };
    const quick = createQuickCalls(new ProviderRegistry([fake.provider]), () => settings);
    await withQuickOn(() => quick.classify('s', 'p', SCHEMA));
    await withQuickOn(() => quick.write('s', 'p', SCHEMA));
    expect(fake.structured.map((request) => request.fastMode)).toEqual([false, true]);
  });

  test('when the default provider fails, the next registered one answers', async () => {
    const claude = fakeProvider('claude', {
      structured: () => Promise.reject(new Error('signed out')),
      text: () => Promise.reject(new Error('signed out')),
    });
    const codex = fakeProvider('codex', { text: () => Promise.resolve('{"from": "codex"}') });
    const quick = createQuickCalls(new ProviderRegistry([claude.provider, codex.provider]), createSettings);
    expect(await withQuickOn(() => quick.classify('s', 'p', SCHEMA))).toEqual({ from: 'codex' });
    expect([claude.structured.length, claude.texts.length, codex.texts.length]).toEqual([1, 1, 1]);
  });

  test('the provider chosen as the default is asked first, then the others in registry order', async () => {
    const asked: string[] = [];
    const providers = ['a', 'b', 'c'].map((id) => {
      const fake = fakeProvider(id, {
        text: () => {
          asked.push(id);
          return Promise.resolve(null);
        },
      });
      return fake.provider;
    });
    let settings = { ...createSettings(), defaultProvider: 'b' };
    const quick = createQuickCalls(new ProviderRegistry(providers), () => settings);
    await withQuickOn(() => quick.write('s', 'p'));
    expect(asked).toEqual(['b', 'a', 'c']);
    asked.length = 0;
    settings = { ...settings, defaultProvider: 'gone' };
    await withQuickOn(() => quick.write('s', 'p'));
    expect(asked).toEqual(['a', 'b', 'c']);
  });

  test('a provider without structured output answers in text, and nothing outside the registry is asked', async () => {
    const plain = fakeProvider('claude', { text: () => Promise.resolve('{"size": "small"}') });
    const outside = fakeProvider('outside', { structured: () => Promise.resolve({ size: 'large' }) });
    const quick = createQuickCalls(new ProviderRegistry([plain.provider]), createSettings);
    expect(await withQuickOn(() => quick.classify('s', 'p', SCHEMA))).toEqual({ size: 'small' });
    expect(plain.texts).toHaveLength(1);
    expect([outside.structured.length, outside.texts.length]).toEqual([0, 0]);
  });

  test('the classifier and the writer use the models chosen in Settings, read at each call', async () => {
    const fake = fakeProvider('claude', { text: () => Promise.resolve('{"ok": true}') });
    let settings = createSettings();
    const quick = createQuickCalls(new ProviderRegistry([fake.provider]), () => settings);
    await withQuickOn(() => quick.classify('s', 'p'));
    await withQuickOn(() => quick.write('s', 'p'));
    settings = { ...settings, agentModels: { classifier: 'haiku', writer: 'opus' } };
    await withQuickOn(() => quick.classify('s', 'p'));
    await withQuickOn(() => quick.write('s', 'p'));
    expect(fake.texts.map((request) => request.model)).toEqual(['sonnet', 'sonnet', 'haiku', 'opus']);
  });

  test('the role’s own provider is asked first, and a fallback provider gets its own model for the role', async () => {
    const claude = fakeProvider('claude', { text: () => Promise.resolve(null) });
    const codex = fakeProvider('codex', { text: () => Promise.resolve('{"ok": true}') });
    const settings = { ...createSettings(), agentModels: { classifier: 'sonnet' } };
    const quick = createQuickCalls(new ProviderRegistry([claude.provider, codex.provider]), () => settings);
    expect(await withQuickOn(() => quick.classify('s', 'p'))).toEqual({ ok: true });
    expect(claude.texts.map((request) => request.model)).toEqual(['sonnet']);
    expect(codex.texts.map((request) => request.model)).toEqual(['gpt-5.6-luna']);
    const moved = {
      ...settings,
      agentProviders: { writer: 'codex' },
      agentModels: { writer: 'gpt-5.6-sol' },
    };
    const writer = createQuickCalls(new ProviderRegistry([claude.provider, codex.provider]), () => moved);
    await withQuickOn(() => writer.write('s', 'p'));
    expect(codex.texts.at(-1)?.model).toBe('gpt-5.6-sol');
    expect(claude.texts).toHaveLength(1);
  });

  test('parseJsonObject tolerates prose, fences and broken JSON', () => {
    expect(parseJsonObject(null)).toBeNull();
    expect(parseJsonObject('{"x": }')).toBeNull();
    expect(parseJsonObject('{"x": 2}')).toEqual({ x: 2 });
    expect(parseJsonObject('```\n{"y": 3}\n```')).toEqual({ y: 3 });
    expect(parseJsonObject('```json\nnot json\n```\n{"z": 4}')).toEqual({ z: 4 });
  });
});
