import {
  listFeedback,
  listFeedbackEntryLeaks,
  listMemory,
  listWatchSuggestions,
  SETTINGS_KEYS,
} from '@shinsa/core';
import { EngineApi } from '@shinsa/core/engine-api';
import { Effect } from 'effect';
import { HttpApiBuilder } from 'effect/http-api';
import { HttpServices } from '../../services/service.ts';
import { findTaskByRef } from '../../task-lookup.ts';
import { listActionViews, listProjectViews, resolveRunView } from '../../task-views.ts';

export const StateHandlers = HttpApiBuilder.group(
  EngineApi,
  'state',
  Effect.fn('StateHandlers')(function* (handlers) {
    const { engine } = yield* HttpServices;

    return handlers
      .handle('settings', () => Effect.sync(() => ({ settings: engine.state.settings, keys: SETTINGS_KEYS })))
      .handle('repos', () => Effect.sync(() => ({ repos: Object.values(engine.state.repos) })))
      .handle('projects', () =>
        Effect.sync(() => ({ projects: listProjectViews(engine.state), focus: engine.state.focus }))
      )
      .handle('schedules', () =>
        Effect.sync(() => ({
          schedules: Object.values(engine.state.schedules),
          suggestions: listWatchSuggestions(engine.state),
        }))
      )
      .handle('memory', () =>
        Effect.sync(() => ({
          memory: listMemory(engine.state).map((entry) => ({
            ...entry,
            project: entry.projectId ? (engine.state.projects[entry.projectId]?.name ?? null) : null,
          })),
        }))
      )
      .handle('feedback', () =>
        Effect.sync(() => ({
          feedback: listFeedback(engine.state).map((entry) => ({
            ...entry,
            task: entry.taskId ? (engine.state.tasks[entry.taskId]?.handle ?? null) : null,
            leaks: entry.title && entry.body ? listFeedbackEntryLeaks(engine.state, entry) : [],
          })),
        }))
      )
      .handle(
        'delegations',
        Effect.fn('StateHandlers.delegations')(function* ({ query }) {
          const state = engine.state;
          const taskId = query.task ? (yield* findTaskByRef(state, query.task)).id : null;
          const delegations = Object.values(state.runs)
            .filter((run) => run.delegation && (!taskId || run.taskId === taskId))
            .sort((a, b) => a.startedAt - b.startedAt)
            .map((run) => ({ taskId: run.taskId, ...resolveRunView(run) }));
          return { delegations };
        })
      )
      .handle('activity', () => Effect.sync(() => ({ actions: listActionViews(engine.state) })));
  })
);
