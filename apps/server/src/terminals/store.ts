import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TerminalInfo } from '@shinsa/core';
import { writeJsonFile } from '../config/file.ts';
import { describeError, log } from '../log/index.ts';

interface StoredTerminals {
  terminals: TerminalInfo[];
}

const ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

const STATUSES = new Set(['running', 'exited', 'stopped']);

const PLACES = new Set(['repository', 'folder', 'worktree']);

function isText(value: unknown): value is string {
  return typeof value === 'string';
}

function isTextOrNull(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isNumberOrNull(value: unknown): value is number | null {
  return value === null || typeof value === 'number';
}

export function parseStoredTerminal(value: unknown): TerminalInfo | null {
  if (!value || typeof value !== 'object') return null;
  const fields = value as Record<string, unknown>;
  if (!(isText(fields.id) && ID_PATTERN.test(fields.id) && isText(fields.projectId) && isText(fields.cwd)))
    return null;
  if (!(STATUSES.has(fields.status as string) && PLACES.has(fields.place as string))) return null;
  if (!(isTextOrNull(fields.name) && isTextOrNull(fields.title) && isTextOrNull(fields.taskId))) return null;
  if (
    !(
      typeof fields.startedAt === 'number' &&
      isNumberOrNull(fields.endedAt) &&
      isNumberOrNull(fields.exitCode)
    )
  )
    return null;
  return fields as unknown as TerminalInfo;
}

export class TerminalStore {
  readonly #dir: string;

  constructor(dataDir: string) {
    this.#dir = join(dataDir, 'terminals');
  }

  get #index() {
    return join(this.#dir, 'terminals.json');
  }

  #screen(id: string) {
    return join(this.#dir, `${id}.screen`);
  }

  readTerminals(): TerminalInfo[] {
    if (!existsSync(this.#index)) return [];
    try {
      const stored = JSON.parse(readFileSync(this.#index, 'utf8')) as Partial<StoredTerminals> | null;
      const terminals = Array.isArray(stored?.terminals) ? stored.terminals : [];
      return terminals.map(parseStoredTerminal).filter((terminal) => terminal !== null);
    } catch (error) {
      log.warn('[Terminals] Could not read the saved terminals', { error: describeError(error) });
      return [];
    }
  }

  writeTerminals(terminals: TerminalInfo[]) {
    writeJsonFile(this.#index, { terminals } satisfies StoredTerminals);
  }

  readScreen(id: string) {
    try {
      return readFileSync(this.#screen(id), 'utf8');
    } catch {
      return null;
    }
  }

  writeScreen(id: string, screen: string) {
    mkdirSync(this.#dir, { recursive: true });
    writeFileSync(this.#screen(id), screen, { mode: 0o600 });
  }

  removeScreen(id: string) {
    rmSync(this.#screen(id), { force: true });
  }
}
