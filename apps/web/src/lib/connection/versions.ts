import type { ProgramId, UpdateOutcome, UpdateStreamLine, VersionsSnapshot } from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import * as React from 'react';
import { describeFailure } from '@/lib/connection/commands.ts';
import { requestJson, requestLines } from '@/lib/connection/http.ts';
import { createSignal } from '@/lib/signal.ts';
import { describeUpdater, describeUpdating, selectProgram } from '@/lib/versions.ts';

interface VersionsView {
  snapshot: VersionsSnapshot | null;
  failure: string | null;
  updating: ProgramId[];
}

const signal = createSignal();

const EMPTY: VersionsView = { snapshot: null, failure: null, updating: [] };

let view: VersionsView = EMPTY;

let pending: Promise<void> | null = null;

function publish(patch: Partial<VersionsView>) {
  view = { ...view, ...patch };
  signal.publish();
}

function publishVersions(snapshot: VersionsSnapshot) {
  publish({ snapshot, failure: null });
}

function recordFailure(error: unknown) {
  publish({ failure: describeFailure(error) });
}

export function selectVersions() {
  return view;
}

export function resetVersions() {
  pending = null;
  view = EMPTY;
  signal.publish();
}

export function refreshVersions() {
  pending ??= requestJson<VersionsSnapshot>('/api/versions')
    .then(publishVersions, recordFailure)
    .then(() => {
      pending = null;
    });
  return pending;
}

export function useVersions(active = true) {
  React.useEffect(() => {
    if (active) void refreshVersions();
  }, [active]);
  return React.useSyncExternalStore(signal.subscribe, selectVersions);
}

export async function checkVersions() {
  try {
    publishVersions(await requestJson<VersionsSnapshot>('/api/versions/refresh', {}));
    return true;
  } catch (error) {
    toast.error(describeFailure(error));
    return false;
  }
}

async function streamUpdate(program: ProgramId, onOutput: (line: string) => void) {
  const answer: { outcome: UpdateOutcome | null } = { outcome: null };
  await requestLines<UpdateStreamLine>('/api/versions/update', { program }, (line) => {
    if (line.type === 'output') onOutput(line.line);
    else answer.outcome = line;
  });
  if (!answer.outcome) throw new Error('The update ended without saying how it went.');
  return answer.outcome;
}

export async function requestUpdate(program: ProgramId) {
  if (view.updating.includes(program)) return false;
  const title = describeUpdating(program);
  const id = toast.loading(title, {
    description: describeUpdater(selectProgram(view.snapshot, program)?.updater ?? null),
  });
  publish({ updating: [...view.updating, program] });
  try {
    const outcome = await streamUpdate(program, (message) =>
      toast.loading(title, { id, description: message })
    );
    publishVersions(outcome.versions);
    if (outcome.ok) toast.success(outcome.message, { id });
    else toast.error(outcome.message, { id });
    return outcome.ok;
  } catch (error) {
    toast.error(describeFailure(error), { id });
    return false;
  } finally {
    publish({ updating: view.updating.filter((entry) => entry !== program) });
  }
}
