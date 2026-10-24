import {
  REFERENCE_SCHEME,
  type Reference,
  type ReferenceCatalog,
  type ReferenceSpan,
  resolveReferenceCatalog,
  type ShinsaState,
  serializeReference,
} from '@shinsa/core';
import { defaultUrlTransform } from 'react-markdown';

type TextPart = { kind: 'text'; text: string } | { kind: 'reference'; span: ReferenceSpan };

const EMPTY_CATALOG: ReferenceCatalog = { tasks: [], pullRequests: [] };

const catalogs = new WeakMap<ShinsaState, ReferenceCatalog>();

let latest = { signature: '', catalog: EMPTY_CATALOG };

export function resolveCatalog(state: ShinsaState | null) {
  if (!state) return EMPTY_CATALOG;
  const cached = catalogs.get(state);
  if (cached) return cached;
  const fresh = resolveReferenceCatalog(state);
  const signature = JSON.stringify(fresh);
  if (signature !== latest.signature) latest = { signature, catalog: fresh };
  catalogs.set(state, latest.catalog);
  return latest.catalog;
}

export function isReferenceHref(href: string | undefined): href is string {
  return href?.slice(0, REFERENCE_SCHEME.length).toLowerCase() === REFERENCE_SCHEME;
}

function matchesRepo(state: ShinsaState, repoId: string | null, name: string) {
  const repoName = repoId ? state.repos[repoId]?.name : undefined;
  return repoName !== undefined && (repoName === name || name.endsWith(`/${repoName}`));
}

export function selectPullRequestTask(
  state: ShinsaState,
  repo: string | null,
  number: number,
  scope: string | null
) {
  const owners = Object.values(state.tasks).filter(
    (task) => task.pullRequest?.number === number && (repo === null || matchesRepo(state, task.repoId, repo))
  );
  if (owners.length === 1) return owners[0] ?? null;
  return owners.find((task) => task.id === scope) ?? null;
}

export function selectRepo(state: ShinsaState, name: string) {
  return (
    Object.values(state.repos).find((repo) => repo.name === name || name.endsWith(`/${repo.name}`)) ?? null
  );
}

export function selectBranchTask(state: ShinsaState, name: string, scope: string | null) {
  const owners = Object.values(state.tasks).filter((task) => task.branch === name);
  const scoped = owners.find((task) => task.id === scope);
  if (scoped) return scoped;
  return owners.length === 1 ? (owners[0] ?? null) : null;
}

export function describeReference(reference: Reference) {
  switch (reference.kind) {
    case 'task':
      return serializeReference(reference);
    case 'pr':
      return `#${reference.number}`;
    case 'repo':
    case 'branch':
      return reference.name;
    case 'file':
      return reference.path;
  }
}

export function splitReferenceText(text: string, spans: ReferenceSpan[]): TextPart[] {
  const parts: TextPart[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) parts.push({ kind: 'text', text: text.slice(cursor, span.start) });
    parts.push({ kind: 'reference', span });
    cursor = span.end;
  }
  if (cursor < text.length) parts.push({ kind: 'text', text: text.slice(cursor) });
  return parts;
}

export function transformUrl(url: string) {
  return isReferenceHref(url) ? url : defaultUrlTransform(url);
}
