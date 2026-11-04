import {
  listFeedback,
  listFeedbackEntryLeaks,
  listMemory,
  listWatchSuggestions,
  SETTINGS_KEYS,
  type ShinsaState,
} from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { EngineCore } from '../../../runtime/engine/service.ts';
import { findTaskByRef } from '../../task-lookup.ts';
import { listActionViews, listProjectViews, resolveRunView } from '../../task-views.ts';

export const StateHandlers = HttpApiBuilder.group(
  EngineApi,
  'state',
  Effect.fn('StateHandlers')(function* (handlers) {
    const engine = yield* EngineCore;
    const read = <A>(view: (state: ShinsaState) => A) => Effect.map(engine.state, view);

    return handlers
      .handle('settings', () => read((state) => ({ settings: state.settings, keys: SETTINGS_KEYS })))
      .handle('repos', () => read((state) => ({ repos: Object.values(state.repos) })))
      .handle('projects', () => read((state) => ({ projects: listProjectViews(state), focus: state.focus })))
      .handle('schedules', () =>
        read((state) => ({
          schedules: Object.values(state.schedules),
          suggestions: listWatchSuggestions(state),
        }))
      )
      .handle('memory', () =>
        read((state) => ({
          memory: listMemory(state).map((entry) => ({
            ...entry,
            project: entry.projectId ? (state.projects[entry.projectId]?.name ?? null) : null,
          })),
        }))
      )
      .handle('feedback', () =>
        read((state) => ({
          feedback: listFeedback(state).map((entry) => ({
            ...entry,
            task: entry.taskId ? (state.tasks[entry.taskId]?.handle ?? null) : null,
            leaks: entry.title && entry.body ? listFeedbackEntryLeaks(state, entry) : [],
          })),
        }))
      )
      .handle(
        'delegations',
        Effect.fn('StateHandlers.delegations')(function* ({ query }) {
          const state = yield* engine.state;
          const taskId = query.task ? (yield* findTaskByRef(state, query.task)).id : null;
          const delegations = Object.values(state.runs)
            .filter((run) => run.delegation && (!taskId || run.taskId === taskId))
            .sort((a, b) => a.startedAt - b.startedAt)
            .map((run) => ({ taskId: run.taskId, ...resolveRunView(run) }));
          return { delegations };
        })
      )
      .handle('activity', () => read((state) => ({ actions: listActionViews(state) })));
  })
);
