import { isAbsolute, join, normalize } from 'node:path';
import {
  DomainError,
  isServiceActive,
  listTaskServices,
  listTerminalPlaces,
  resolveServiceUrl,
  resolveTaskProject,
  type ServiceDefinition,
  type ServiceView,
  selectService,
  type TaskServiceView,
} from '@shinsa/core';
import { Effect, Option } from 'effect';
import { isInside } from '../../files/paths.ts';
import { isPresent } from '../../files/probe.ts';
import { describeError } from '../../log/index.ts';
import { readServiceInput } from '../../terminals/input.ts';
import { selectServiceRunIn } from '../../terminals/runs.ts';
import { readString } from '../handover.ts';
import { ToolCallFailed } from '../tools/schema.ts';
import {
  SERVICE_ACTIONS,
  SERVICE_OUTPUT_LINES,
  type ServiceAction,
  type ServiceToolContext,
  type ServiceToolName,
} from './schema.ts';

export const runServiceTool = Effect.fn('ServiceTools.run')(function* (
  name: ServiceToolName,
  input: Record<string, unknown>,
  context: ServiceToolContext
) {
  const { state, task, runner, now } = context;

  const refuse = (message: string) => new ToolCallFailed({ message });

  const describePreview = (view: Pick<ServiceView, 'url' | 'state'>) =>
    view.url && isServiceActive(view) ? `, preview at ${view.url}` : '';

  const describeView = (view: TaskServiceView) => {
    const exit = view.state === 'failed' && view.exitCode !== null ? ` with code ${view.exitCode}` : '';
    return `- ${view.service.name} (${view.state}${exit}): \`${view.service.command}\` in ${view.cwd}${describePreview(view)}`;
  };

  const describeRunnable = (views: TaskServiceView[]) => {
    if (views.length === 0)
      return [
        'None of the project’s services can run for this task: their folders are outside this task’s repository, or the task has no worktree of its own.',
      ];
    return ['The project’s services, as they run for this task:', ...views.map(describeView)];
  };

  const describeOthers = (others: ServiceDefinition[]) => {
    if (others.length === 0) return [];
    return [
      'Its other services, which cannot run for this task:',
      ...others.map((service) => `- ${service.name}: \`${service.command}\` in ${service.cwd}`),
    ];
  };

  const describeFolder = (relative: string) => (relative ? `\`${relative}\`` : 'the repository’s root');

  const describeRunner = (taskId: string | null) => {
    if (taskId === null) return 'the human';
    return `task ${state.tasks[taskId]?.handle ?? taskId}`;
  };

  const findView = Effect.fn('ServiceTools.findView')(function* (
    views: TaskServiceView[],
    reference: string
  ) {
    const wanted = reference.toLowerCase();
    const view =
      views.find((each) => each.service.id === reference) ??
      views.find((each) => each.service.name.toLowerCase() === wanted);
    if (!view) return yield* refuse(`No service ${reference} for this task. Call list_services to see them.`);
    return view;
  });

  const readAction = Effect.fn('ServiceTools.readAction')(function* () {
    const action = readString(input, 'action');
    if (!SERVICE_ACTIONS.includes(action as ServiceAction))
      return yield* refuse('action must be start, stop or restart.');
    return action as ServiceAction;
  });

  const resolveRun = Effect.fn('ServiceTools.resolveRun')(function* (view: TaskServiceView) {
    const run = yield* selectServiceRunIn(state, view.service, task.id, runner);
    if (Option.isNone(run)) return yield* refuse(`${view.service.name} cannot run for this task.`);
    if (!(yield* isPresent(run.value.cwd)))
      return yield* refuse(`The folder ${run.value.cwd} is not in the worktree.`);
    return run.value;
  });

  const listServices = Effect.fn('ServiceTools.list')(function* () {
    const snapshot = yield* runner.snapshot;
    const views = listTaskServices(state, snapshot, task, now);
    const reference = readString(input, 'service');
    if (!reference) {
      const projectId = resolveTaskProject(state, task);
      const others = snapshot.services.filter(
        (service) => service.projectId === projectId && !views.some((each) => each.service.id === service.id)
      );
      if (views.length === 0 && others.length === 0)
        return 'The project has no services. Add the one you need with add_service.';
      return [...describeRunnable(views), ...describeOthers(others)].join('\n');
    }
    const view = yield* findView(views, reference);
    const output = yield* runner.readServiceOutput(view.service.id, task.id, SERVICE_OUTPUT_LINES);
    if (output.length === 0) return `${describeView(view)}\nNo output yet.`;
    return `${describeView(view)}\nIts last ${output.length} lines:\n\`\`\`text\n${output.join('\n')}\n\`\`\``;
  });

  const runService = Effect.fn('ServiceTools.runService')(function* () {
    const action = yield* readAction();
    const reference = readString(input, 'service');
    if (!reference) return yield* refuse('service is required.');
    const view = yield* findView(listTaskServices(state, yield* runner.snapshot, task, now), reference);
    const { name: serviceName } = view.service;
    if (action === 'stop') {
      yield* runner.stopService(view.service.id, task.id);
      return `Stopped ${serviceName} for this task.`;
    }
    if (action === 'start' && isServiceActive(view))
      return `${serviceName} already runs for this task in ${view.cwd}${describePreview(view)}.`;
    const run = yield* resolveRun(view);
    const terminal =
      action === 'start'
        ? yield* runner.startService(view.service.id, run)
        : yield* runner.restartService(view.service.id, run);
    const url = resolveServiceUrl(view.service, terminal);
    const preview = url ? ` Its preview is at ${url} once it is up.` : '';
    return `${action === 'start' ? 'Started' : 'Restarted'} ${serviceName} for this task in ${run.cwd}.${preview} Read its output with list_services and the service’s name.`;
  });

  const resolveServiceFolder = Effect.fn('ServiceTools.resolveFolder')(function* (repoPath: string) {
    const path = readString(input, 'path')?.trim() ?? '.';
    const relative = normalize(path).replace(/\/+$/, '');
    if (isAbsolute(relative) || !isInside(repoPath, join(repoPath, relative)))
      return yield* refuse('path must be a folder inside this task’s repository, relative to its root.');
    return {
      relative: relative === '.' ? '' : relative,
      cwd: relative === '.' ? repoPath : join(repoPath, relative),
    };
  });

  const addService = Effect.fn('ServiceTools.add')(function* () {
    const repo = task.repoId ? state.repos[task.repoId] : undefined;
    const projectId = resolveTaskProject(state, task);
    if (!(repo && projectId))
      return yield* refuse('add_service needs a task that works in a project’s repository.');
    const { relative, cwd } = yield* resolveServiceFolder(repo.path);
    if (!(yield* isPresent(cwd)))
      return yield* refuse(
        `${describeFolder(relative)} is not in the repository’s own checkout yet. A service runs from a folder on the default branch.`
      );
    const others = (yield* runner.snapshot).services.filter((each) => each.projectId === projectId);
    const serviceInput = yield* Effect.try({
      try: () =>
        readServiceInput(
          {
            name: input.name ?? '',
            path: cwd,
            command: input.command ?? '',
            env: input.env === undefined || input.env === null ? {} : input.env,
            previewUrl: input.preview_url ?? null,
            portVariable: input.port_variable ?? null,
          },
          others,
          listTerminalPlaces(state, projectId),
          runner.home
        ),
      catch: (error) => (error instanceof DomainError ? error : refuse(describeError(error))),
    });
    const added = yield* runner.addService(projectId, serviceInput).pipe(
      Effect.catchIf(
        (error) => error.code === 'service_limit',
        (error) => Effect.fail(refuse(`${error.message} You can remove one with remove_service.`))
      )
    );
    return `Added ${added.name} to the project: \`${added.command}\` in ${describeFolder(relative)}. The human sees it under Services. Start it for this task with run_service.`;
  });

  const readServiceReferences = Effect.fn('ServiceTools.readReferences')(function* () {
    const { services } = input;
    if (
      !(Array.isArray(services) && services.length > 0 && services.every((each) => typeof each === 'string'))
    )
      return yield* refuse('services must be a list of the services’ names.');
    return services.map((each) => each.trim());
  });

  const assertRunsOnlyHere = Effect.fn('ServiceTools.assertRunsOnlyHere')(function* (
    service: ServiceDefinition
  ) {
    const elsewhere = (yield* runner.snapshot).terminals.filter(
      (terminal) =>
        terminal.serviceId === service.id && terminal.taskId !== task.id && terminal.status === 'running'
    );
    if (elsewhere.length === 0) return;
    const runners = elsewhere.map((terminal) => describeRunner(terminal.taskId)).join(' and ');
    return yield* refuse(
      `Nothing was removed: ${service.name} runs for ${runners}. Leave it, or ask the human to stop that run first.`
    );
  });

  const removeServices = Effect.fn('ServiceTools.remove')(function* () {
    const projectId = resolveTaskProject(state, task);
    if (!projectId) return yield* refuse('remove_service needs a task in a project.');
    const snapshot = yield* runner.snapshot;
    const removed = new Map<string, ServiceDefinition>();
    for (const reference of yield* readServiceReferences()) {
      const service = selectService(snapshot, reference, projectId);
      if (!service)
        return yield* refuse(`No service ${reference} in the project. Call list_services to see them.`);
      removed.set(service.id, service);
    }
    yield* Effect.forEach(removed.values(), assertRunsOnlyHere, { discard: true });
    yield* runner.removeServices([...removed.keys()]);
    const names = [...removed.values()].map((service) => service.name).join(', ');
    return `Removed ${names} from the project. The human no longer sees them under Services.`;
  });

  if (name === 'add_service') return yield* addService();
  if (name === 'remove_service') return yield* removeServices();
  if (name === 'list_services') return yield* listServices();
  return yield* runService();
});
