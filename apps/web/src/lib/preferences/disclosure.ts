import * as React from 'react';
import { createSignal } from '@/lib/signal.ts';

export const DISCLOSURE_STORE_KEY = 'shinsa.disclosures';

export const DISCLOSURE_STORE_VERSION = 1;

export const DISCLOSURE_LIMIT = 600;

export const DISCLOSURE_WRITE_DELAY_MS = 250;

export type DisclosureScope =
  | 'task'
  | 'home'
  | 'queue'
  | 'services'
  | 'tasks'
  | 'settings'
  | 'automation'
  | 'ui';

declare const PERSISTED: unique symbol;

export type DisclosureId = string & { readonly [PERSISTED]: true };

export interface NotPersisted {
  readonly notPersisted: string;
}

export type DisclosurePersistId = DisclosureId | NotPersisted;

declare const DISCLOSURE: unique symbol;

export interface Disclosure {
  readonly open: boolean;
  readonly replaceOpen: (open: boolean) => void;
  readonly toggle: () => void;
  readonly [DISCLOSURE]: true;
}

interface StoredDisclosures {
  version: number;
  entries: [string, boolean][];
}

const signal = createSignal();

let entries: Map<string, boolean> | null = null;

let timer: ReturnType<typeof setTimeout> | null = null;

const pending = new Map<string, boolean>();

let listening = false;

function joinParts(parts: readonly string[]) {
  return parts.map((part) => part.replaceAll(':', '%3A')).join(':');
}

export function createDisclosureId(scope: DisclosureScope, ...parts: string[]): DisclosureId {
  return joinParts([scope, ...parts]) as DisclosureId;
}

export function resolveTaskDisclosureId(taskId: string, ...parts: string[]): DisclosureId {
  return createDisclosureId('task', taskId, ...parts);
}

export function resolveOverviewPanelId(task: { id: string }, panel: string): DisclosureId {
  return resolveTaskDisclosureId(task.id, 'overview', 'panel', panel);
}

export function extendDisclosureId(base: DisclosurePersistId, ...parts: string[]): DisclosurePersistId {
  if (typeof base !== 'string') return base;
  return `${base}:${joinParts(parts)}` as DisclosureId;
}

export function hashDisclosurePart(text: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function notPersisted(reason: string): NotPersisted {
  return { notPersisted: reason };
}

function isEntry(value: unknown): value is [string, boolean] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'string' &&
    typeof value[1] === 'boolean'
  );
}

export function parseDisclosures(raw: string | null): Map<string, boolean> {
  if (raw === null) return new Map();
  try {
    const parsed = JSON.parse(raw) as Partial<StoredDisclosures> | null;
    if (parsed?.version !== DISCLOSURE_STORE_VERSION || !Array.isArray(parsed.entries)) return new Map();
    return new Map(parsed.entries.filter(isEntry).slice(-DISCLOSURE_LIMIT));
  } catch {
    return new Map();
  }
}

export function serializeDisclosures(map: ReadonlyMap<string, boolean>): string {
  const stored: StoredDisclosures = { version: DISCLOSURE_STORE_VERSION, entries: [...map] };
  return JSON.stringify(stored);
}

function pruneDisclosures(map: Map<string, boolean>) {
  for (const id of map.keys()) {
    if (map.size <= DISCLOSURE_LIMIT) return;
    map.delete(id);
  }
}

function handleStorage(event: StorageEvent) {
  if (event.key !== null && event.key !== DISCLOSURE_STORE_KEY) return;
  const incoming = parseDisclosures(event.newValue);
  for (const [id, open] of pending) {
    incoming.delete(id);
    incoming.set(id, open);
  }
  pruneDisclosures(incoming);
  entries = incoming;
  signal.publish();
}

function listen() {
  if (listening) return;
  listening = true;
  window.addEventListener('storage', handleStorage);
  window.addEventListener('pagehide', flushDisclosures);
}

function readStore() {
  if (entries === null) {
    listen();
    entries = parseDisclosures(localStorage.getItem(DISCLOSURE_STORE_KEY));
  }
  return entries;
}

export function readDisclosure(id: DisclosureId): boolean | undefined {
  return readStore().get(id);
}

export function listMarkedDisclosures(prefix: DisclosureId, marked: boolean): string[] {
  const start = `${prefix}:`;
  const found: string[] = [];
  for (const [id, value] of readStore()) {
    if (value === marked && id.startsWith(start)) found.push(id.slice(start.length).replaceAll('%3A', ':'));
  }
  return found.sort();
}

export function flushDisclosures() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending.clear();
  if (entries === null) return;
  localStorage.setItem(DISCLOSURE_STORE_KEY, serializeDisclosures(entries));
}

export function writeDisclosure(id: DisclosureId, open: boolean) {
  const store = readStore();
  if (store.get(id) === open) return;
  store.delete(id);
  store.set(id, open);
  pending.set(id, open);
  pruneDisclosures(store);
  signal.publish();
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(flushDisclosures, DISCLOSURE_WRITE_DELAY_MS);
}

export function resetDisclosures() {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  pending.clear();
  entries = null;
}

const DisclosureScopeContext = React.createContext<DisclosurePersistId>(
  notPersisted('rendered outside a disclosure scope')
);

export const DisclosureScope = DisclosureScopeContext.Provider;

export function useDisclosureScope(...parts: string[]): DisclosurePersistId {
  return extendDisclosureId(React.useContext(DisclosureScopeContext), ...parts);
}

export function useDisclosure(persistId: DisclosurePersistId, defaultOpen: boolean): Disclosure {
  const id = typeof persistId === 'string' ? persistId : null;
  const [local, replaceLocal] = React.useState(defaultOpen);
  const stored = React.useSyncExternalStore(signal.subscribe, () =>
    id === null ? undefined : readDisclosure(id)
  );
  const open = id === null ? local : (stored ?? defaultOpen);
  const update = React.useCallback(
    (next: boolean) => (id === null ? replaceLocal(next) : writeDisclosure(id, next)),
    [id]
  );
  return React.useMemo(
    () => ({ open, replaceOpen: update, toggle: () => update(!open) }) as Disclosure,
    [open, update]
  );
}

export function useDisclosureSet(prefix: DisclosurePersistId, marked: boolean) {
  const id = typeof prefix === 'string' ? prefix : null;
  const [local, replaceLocal] = React.useState<ReadonlySet<string>>(() => new Set());
  const listed = React.useSyncExternalStore(signal.subscribe, () =>
    id === null ? '' : listMarkedDisclosures(id, marked).join('\n')
  );
  const members = React.useMemo<ReadonlySet<string>>(
    () => (id === null ? local : new Set(listed ? listed.split('\n') : [])),
    [id, local, listed]
  );
  const update = React.useCallback(
    (key: string, member: boolean) => {
      if (id !== null) {
        writeDisclosure(extendDisclosureId(id, key) as DisclosureId, member ? marked : !marked);
        return;
      }
      replaceLocal((current) => {
        const next = new Set(current);
        if (member) next.add(key);
        else next.delete(key);
        return next;
      });
    },
    [id, marked]
  );
  return [members, update] as const;
}
