import type { ProgramId, UpdateOutcome, VersionsSnapshot } from '@shinsa/core';
import { toast } from '@shinsa/ui/components/sonner';
import { Effect, Stream } from 'effect';
import * as React from 'react';
import { runApp } from '@/lib/runtime/app.ts';
import { streamLines } from '@/lib/runtime/engine/lines.ts';
import { EngineClient } from '@/lib/runtime/engine/service.ts';
import { createSharedRun } from '@/lib/runtime/shared-run.ts';
import { createSignal } from '@/lib/signal.ts';
import { describeUpdater, describeUpdating, selectProgram } from '@/lib/versions.ts';
import { UPDATE_UNFINISHED_MESSAGE, UpdateLine, UpdateUnfinished } from './schema.ts';

interface VersionsView {
  snapshot: VersionsSnapshot | null;
  failure: string | null;
  updating: ProgramId[];
}

const signal = createSignal();

const EMPTY: VersionsView = { snapshot: null, failure: null, updating: [] };

let view: VersionsView = EMPTY;

function publish(patch: Partial<VersionsView>) {
  view = { ...view, ...patch };
  signal.publish();
}

function publishVersions(snapshot: VersionsSnapshot) {
  publish({ snapshot, failure: null });
}

const readLines = streamLines(UpdateLine);

const read = createSharedRun(
  Effect.gen(function* () {
    const engine = yield* EngineClient;
    publishVersions(yield* engine.versions.snapshot());
  }).pipe(Effect.catch((error) => Effect.sync(() => publish({ failure: error.message }))))
);

const check = Effect.gen(function* () {
  const engine = yield* EngineClient;
  publishVersions(yield* engine.versions.refresh());
  return true;
}).pipe(
  Effect.catch((error) =>
    Effect.sync(() => {
      toast.error(error.message);
      return false;
    })
  )
);

const streamUpdate = Effect.fn('Versions.streamUpdate')(function* (
  program: ProgramId,
  onOutput: (line: string) => void
) {
  const engine = yield* EngineClient;
  const response = yield* engine.versions.update({
    payload: { program },
    responseMode: 'response-only',
  });
  const outcome = yield* readLines(response).pipe(
    Stream.tap((line) =>
      Effect.sync(() => {
        if (line.type === 'output') onOutput(line.line);
      })
    ),
    Stream.runFold(
      (): UpdateOutcome | null => null,
      (found, line) => (line.type === 'output' ? found : line)
    )
  );
  if (outcome === null) return yield* new UpdateUnfinished({ message: UPDATE_UNFINISHED_MESSAGE });
  return outcome;
}, Effect.provide(EngineClient.askingLines));

const runUpdate = Effect.fn('Versions.runUpdate')(function* (program: ProgramId) {
  const title = describeUpdating(program);
  const id = toast.loading(title, {
    description: describeUpdater(selectProgram(view.snapshot, program)?.updater ?? null),
  });
  publish({ updating: [...view.updating, program] });
  return yield* streamUpdate(program, (message) => toast.loading(title, { id, description: message })).pipe(
    Effect.map((outcome) => {
      publishVersions(outcome.versions);
      if (outcome.ok) toast.success(outcome.message, { id });
      else toast.error(outcome.message, { id });
      return outcome.ok;
    }),
    Effect.catch((error) =>
      Effect.sync(() => {
        toast.error(error.message, { id });
        return false;
      })
    ),
    Effect.ensuring(
      Effect.sync(() => publish({ updating: view.updating.filter((entry) => entry !== program) }))
    )
  );
});

export function selectVersions() {
  return view;
}

export function resetVersions() {
  read.reset();
  view = EMPTY;
  signal.publish();
}

export function refreshVersions() {
  return read.run();
}

export function useVersions(active = true) {
  React.useEffect(() => {
    if (active) void refreshVersions();
  }, [active]);
  return React.useSyncExternalStore(signal.subscribe, selectVersions);
}

export function checkVersions() {
  return runApp(check);
}

export function requestUpdate(program: ProgramId) {
  if (view.updating.includes(program)) return Promise.resolve(false);
  return runApp(runUpdate(program));
}
