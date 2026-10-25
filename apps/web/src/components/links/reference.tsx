import {
  linkReferences,
  listReferenceSpans,
  parseReference,
  type Reference,
  type ReferenceOptions,
  type ShinsaState,
} from '@shinsa/core';
import * as React from 'react';
import { BranchChip } from '@/components/links/branch.tsx';
import { FileLink } from '@/components/links/file.tsx';
import { PrLink } from '@/components/links/pull-request.tsx';
import { RepoChip } from '@/components/links/repo.tsx';
import { TaskLink } from '@/components/links/task.tsx';
import { useShinsaSelector } from '@/lib/connection/selectors.ts';
import { useConnection } from '@/lib/connection/socket.ts';
import { createScopedCache } from '@/lib/format/cache.ts';
import {
  describeReference,
  resolveCatalog,
  selectBranchTask,
  selectPullRequestTask,
  selectRepo,
  splitReferenceText,
} from '@/lib/tasks/references.ts';
import { resolveRouteTaskId, useRoute, useRouteTaskId } from '@/router.ts';

function useReferenceScope() {
  const { state } = useConnection();
  return useRouteTaskId(state);
}

const LINKED_LIMIT = 400;

const linked = createScopedCache<ReturnType<typeof resolveCatalog>, string>(LINKED_LIMIT);

export function useReferenceMarkdown(text: string) {
  const route = useRoute();
  const selectScope = React.useCallback((state: ShinsaState) => resolveRouteTaskId(state, route), [route]);
  const scope = useShinsaSelector(selectScope);
  const catalog = useShinsaSelector(resolveCatalog) ?? resolveCatalog(null);
  return linked(catalog).read(`${scope ?? ''}\u0000${text}`, () =>
    linkReferences(text, catalog, { exclude: new Set(scope ? [scope] : []) })
  );
}

function Fallback({ reference, label }: { reference: Reference; label: React.ReactNode }) {
  if (label !== null && label !== undefined && label !== '') return <>{label}</>;
  return <>{describeReference(reference)}</>;
}

function ReferenceLink({
  state,
  reference,
  label,
  scope,
}: {
  state: ShinsaState;
  reference: Reference;
  label: React.ReactNode;
  scope: string | null;
}) {
  switch (reference.kind) {
    case 'task': {
      const task = state.tasks[reference.id];
      return task ? <TaskLink state={state} task={task} /> : <Fallback reference={reference} label={label} />;
    }
    case 'pr': {
      const task = selectPullRequestTask(state, reference.repo, reference.number, scope);
      return task ? <PrLink state={state} task={task} /> : <Fallback reference={reference} label={label} />;
    }
    case 'repo': {
      const repo = selectRepo(state, reference.name);
      return repo ? <RepoChip state={state} repo={repo} /> : <Fallback reference={reference} label={label} />;
    }
    case 'branch':
      return (
        <BranchChip
          state={state}
          task={selectBranchTask(state, reference.name, scope)}
          name={reference.name}
        />
      );
    case 'file':
      return (
        <FileLink
          task={scope ? (state.tasks[scope] ?? null) : null}
          path={reference.path}
          line={reference.line}
          end={reference.end}
          label={typeof label === 'string' ? label : undefined}
        />
      );
  }
}

export function ReferenceAnchor({ href, children }: { href: string; children?: React.ReactNode }) {
  const { state } = useConnection();
  const scope = useReferenceScope();
  const reference = parseReference(href);
  if (!reference || !state) return <>{children}</>;
  return <ReferenceLink state={state} reference={reference} label={children} scope={scope} />;
}

export function ReferenceLabel({ href, children }: { href: string; children?: React.ReactNode }) {
  const { state } = useConnection();
  const reference = parseReference(href);
  if (!reference) return <>{children}</>;
  const task = reference.kind === 'task' ? state?.tasks[reference.id] : undefined;
  return (
    <span className='font-medium text-fg-4'>
      {task ? task.title : <Fallback reference={reference} label={children} />}
    </span>
  );
}

export function ReferenceText({
  text,
  state,
  options,
}: {
  text: string;
  state: ShinsaState;
  options?: ReferenceOptions;
}) {
  const scope = useReferenceScope();
  const exclude = new Set([...(options?.exclude ?? []), ...(scope ? [scope] : [])]);
  const parts = splitReferenceText(
    text,
    listReferenceSpans(text, resolveCatalog(state), { ...options, exclude })
  );
  return (
    <>
      {parts.map((part) =>
        part.kind === 'text' ? (
          part.text
        ) : (
          <ReferenceLink
            key={`${part.span.start}-${part.span.end}`}
            state={state}
            reference={part.span.reference}
            label={part.span.label}
            scope={scope}
          />
        )
      )}
    </>
  );
}
