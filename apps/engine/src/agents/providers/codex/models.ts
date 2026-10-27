import { tmpdir } from 'node:os';
import { type AgentModel, KNOWN_CODEX_MODELS, resolveModelLabel } from '@shinsa/core';
import { describeError, log } from '../../../log/index.ts';
import { CodexClient, readText } from './client.ts';
import { CODEX_RUNTIME, type CodexRuntime } from './session.ts';

const CATALOG_TIMEOUT_MS = 20_000;

const MAX_PAGES = 10;

type Params = Record<string, unknown>;

export function resolveCodexModels(rows: unknown[]): AgentModel[] {
  return rows.flatMap((row) => {
    if (!row || typeof row !== 'object') return [];
    const record = row as Params;
    const id = readText(record, 'model') || readText(record, 'id');
    if (!id || record.hidden === true) return [];
    return [
      {
        id,
        label: readText(record, 'displayName') || resolveModelLabel(id),
        description: readText(record, 'description'),
      },
    ];
  });
}

async function requestModelRows(runtime: CodexRuntime, timeoutMs: number) {
  const executable = await runtime.resolveExecutable();
  if (!executable.ok) throw new Error(executable.message);
  const client = new CodexClient({ path: executable.path, cwd: tmpdir(), env: runtime.env });
  const timer = setTimeout(() => client.close(), timeoutMs);
  try {
    await client.initialize();
    const rows: unknown[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const response: Params = await client.request('model/list', cursor ? { cursor } : {});
      if (Array.isArray(response.data)) rows.push(...response.data);
      cursor = typeof response.nextCursor === 'string' && response.nextCursor ? response.nextCursor : null;
      if (!cursor) break;
    }
    return rows;
  } finally {
    clearTimeout(timer);
    client.close();
  }
}

export class CodexModelCatalog {
  readonly #runtime: CodexRuntime;
  readonly #timeoutMs: number;
  #catalog: Promise<AgentModel[]> | null = null;

  constructor(runtime: CodexRuntime = CODEX_RUNTIME, timeoutMs = CATALOG_TIMEOUT_MS) {
    this.#runtime = runtime;
    this.#timeoutMs = timeoutMs;
  }

  list(): Promise<AgentModel[]> {
    this.#catalog ??= this.#request();
    return this.#catalog;
  }

  async #request() {
    try {
      const models = resolveCodexModels(await requestModelRows(this.#runtime, this.#timeoutMs));
      if (models.length === 0) throw new Error('Codex reported no models.');
      return models;
    } catch (error) {
      log.warn('[Models] Falling back to the built-in Codex list', { error: describeError(error) });
      this.#catalog = null;
      return KNOWN_CODEX_MODELS;
    }
  }
}
