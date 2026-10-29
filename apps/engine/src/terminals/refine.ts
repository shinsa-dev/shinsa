import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isServiceEnvKey,
  isServicePreviewUrl,
  SERVICE_LIMITS,
  SERVICE_PORT_VARIABLE,
  type ServiceSuggestion,
} from '@shinsa/core';
import type { JsonSchema } from '../agents/providers/index.ts';
import type { QuickJson } from '../agents/quick/index.ts';

export interface RefinedSuggestions {
  suggestions: ServiceSuggestion[];
  refined: boolean;
}

interface FolderDigest {
  folder: string;
  scripts: Record<string, string>;
  dependencies: string[];
}

interface RefinedEntry {
  index: number;
  name: string;
  command: string;
  previewUrl: string;
  portVariable: string;
  recommended: boolean;
}

interface CachedRefinement {
  fingerprint: string;
  answer: Promise<ServiceSuggestion[] | null>;
}

export const REFINE_LIMITS = { scripts: 12, script: 200, dependencies: 60 };

const REFINE_SYSTEM = [
  'You set up the services of a software project: the commands a developer keeps running while they work, such as a web dev server, an API or a worker.',
  'You are given candidates a file scan found, each with its index, folder, command and source, and for each folder its package.json scripts and dependency names.',
  'Answer with one entry per candidate you have something to say about, by its index:',
  '- name: short and lower case, such as web, api, docs or worker; unique among the entries.',
  '- command: the candidate’s command, changed only where it must be. Every run gets a free port in the variable named by portVariable, so a server must listen on it: Next, Remix, Astro, Nuxt, Express and most Node servers read PORT themselves; Vite and Vite-based tools need `--port $PORT` (add `--` before it for npm run, as in `npm run dev -- --port $PORT`); a server that takes its port only as a flag gets that flag with $PORT.',
  '- previewUrl: for a server a person opens in a browser, its URL with {port} where the port goes, such as http://localhost:{port}; an empty string for anything else (a worker, a database, a library’s watcher, an API nobody opens).',
  '- portVariable: the variable the command reads its port from; an empty string for PORT.',
  '- recommended: true for an app or a server someone keeps running; false for a library’s build watcher, a script that runs every workspace at once, or anything that ends by itself.',
  'Never invent a command a candidate does not have. Leave out candidates you would not change.',
].join('\n');

const REFINE_SCHEMA: JsonSchema = {
  type: 'object',
  properties: {
    services: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'integer' },
          name: { type: 'string' },
          command: { type: 'string' },
          previewUrl: { type: 'string' },
          portVariable: { type: 'string' },
          recommended: { type: 'boolean' },
        },
        required: ['index', 'name', 'command', 'previewUrl', 'portVariable', 'recommended'],
      },
    },
  },
  required: ['services'],
};

function readPackageFields(folder: string) {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(folder, 'package.json'), 'utf8'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function listStringEntries(value: unknown) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string');
}

export function readFolderDigest(folder: string): FolderDigest {
  const fields = readPackageFields(folder);
  const scripts = listStringEntries(fields?.scripts)
    .slice(0, REFINE_LIMITS.scripts)
    .map(([name, script]) => [name, script.slice(0, REFINE_LIMITS.script)]);
  const dependencies = [
    ...listStringEntries(fields?.dependencies),
    ...listStringEntries(fields?.devDependencies),
  ]
    .map(([name]) => name)
    .slice(0, REFINE_LIMITS.dependencies);
  return { folder, scripts: Object.fromEntries(scripts), dependencies };
}

function serializeRefinePrompt(candidates: ServiceSuggestion[], digests: FolderDigest[]) {
  return JSON.stringify({
    candidates: candidates.map((each, index) => ({
      index,
      name: each.name,
      folder: each.cwd,
      command: each.command,
      source: each.source,
    })),
    folders: digests,
  });
}

function parseEntry(value: unknown): RefinedEntry | null {
  if (!value || typeof value !== 'object') return null;
  const entry = value as Record<string, unknown>;
  const { index, name, command, previewUrl, portVariable, recommended } = entry;
  if (
    !Number.isInteger(index) ||
    typeof name !== 'string' ||
    typeof command !== 'string' ||
    typeof previewUrl !== 'string' ||
    typeof portVariable !== 'string' ||
    typeof recommended !== 'boolean'
  )
    return null;
  return { index: index as number, name, command, previewUrl, portVariable, recommended };
}

export function parseRefinedEntries(value: unknown): RefinedEntry[] | null {
  const services = (value as { services?: unknown } | null)?.services;
  if (!Array.isArray(services)) return null;
  return services.flatMap((each) => {
    const entry = parseEntry(each);
    return entry ? [entry] : [];
  });
}

function resolveText(value: string, limit: number, fallback: string) {
  const trimmed = value.trim();
  return trimmed && trimmed.length <= limit ? trimmed : fallback;
}

function resolvePreviewUrl(value: string) {
  const url = value.trim();
  return url.length <= SERVICE_LIMITS.previewUrl && isServicePreviewUrl(url) ? url : null;
}

function resolvePortVariable(value: string) {
  const name = value.trim();
  return name && isServiceEnvKey(name) ? name : SERVICE_PORT_VARIABLE;
}

function resolveFreeName(wanted: string, fallback: string, taken: Set<string>, index: number) {
  for (const name of [wanted, fallback, `${fallback}-${index + 1}`])
    if (!taken.has(name.toLowerCase())) return name;
  return `${fallback}-${index + 1}-${taken.size}`;
}

export function resolveRefinedSuggestions(
  candidates: ServiceSuggestion[],
  entries: RefinedEntry[]
): ServiceSuggestion[] {
  const taken = new Set<string>();
  return candidates.map((candidate, index) => {
    const entry = entries.find((each) => each.index === index);
    const refined = entry
      ? {
          ...candidate,
          name: resolveText(entry.name, SERVICE_LIMITS.name, candidate.name),
          command: resolveText(entry.command, SERVICE_LIMITS.command, candidate.command),
          previewUrl: resolvePreviewUrl(entry.previewUrl),
          portVariable: resolvePortVariable(entry.portVariable),
          recommended: entry.recommended,
        }
      : candidate;
    const name = resolveFreeName(refined.name, candidate.name, taken, index);
    taken.add(name.toLowerCase());
    return { ...refined, name };
  });
}

export class ServiceRefiner {
  readonly #ask: QuickJson;
  readonly #cache = new Map<string, CachedRefinement>();

  constructor(ask: QuickJson) {
    this.#ask = ask;
  }

  async refine(projectId: string, candidates: ServiceSuggestion[]): Promise<RefinedSuggestions> {
    if (candidates.length === 0) return { suggestions: candidates, refined: false };
    const digests = [...new Set(candidates.map((each) => each.cwd))].map(readFolderDigest);
    const prompt = serializeRefinePrompt(candidates, digests);
    const cached = this.#cache.get(projectId);
    const answer = cached?.fingerprint === prompt ? cached.answer : this.#request(candidates, prompt);
    this.#cache.set(projectId, { fingerprint: prompt, answer });
    const suggestions = await answer;
    if (suggestions) return { suggestions, refined: true };
    if (this.#cache.get(projectId)?.answer === answer) this.#cache.delete(projectId);
    return { suggestions: candidates, refined: false };
  }

  async #request(candidates: ServiceSuggestion[], prompt: string) {
    const answer = await this.#ask<unknown>(REFINE_SYSTEM, prompt, REFINE_SCHEMA);
    const entries = parseRefinedEntries(answer);
    return entries ? resolveRefinedSuggestions(candidates, entries) : null;
  }
}
