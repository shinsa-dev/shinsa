import { existsSync, readFileSync } from 'node:fs';
import {
  DomainError,
  type OnboardingCheck,
  type OnboardingFlow,
  type OnboardingProjectChoice,
  type OnboardingReply,
  type OnboardingStep,
  type OnboardingStepId,
} from '@shinsa/core';
import { writeJsonFile } from '../config/file.ts';
import type { JsonObject } from '../http/body.ts';
import { describeError, log } from '../log/index.ts';
import type { ProjectRevision } from './revise.ts';
import { PrivateFoldersError } from './roots.ts';
import type { SetupPatch, StepDefinition, StepReadContext } from './steps.ts';
import { listFailingChecks } from './welcome.ts';

interface Draft {
  version: 6;
  id: string;
  index: number;
  furthest: number;
  saves: number;
  revisit: boolean;
  problem: string | null;
  access: string[];
  picked: string[];
  revision: ProjectRevision | null;
  help: string | null;
}

export type FlowContext = StepReadContext & {
  save: (patch: SetupPatch, commandId: string) => Promise<void>;
  createProjects: (choices: OnboardingProjectChoice[] | undefined, commandId: string) => Promise<void>;
};

interface FlowOptions {
  path: string;
  steps: readonly StepDefinition[];
  resolveContext: (revision: ProjectRevision | null) => FlowContext;
  reviseProjects: (
    revision: ProjectRevision | null,
    text: string,
    choices: OnboardingProjectChoice[] | undefined
  ) => Promise<ProjectRevision>;
  isCompleted: () => boolean;
  complete: () => Promise<void>;
  requestHelp: (checks: OnboardingCheck[]) => Promise<string | null>;
  selectWelcome: () => string | null;
  readOnly?: boolean;
}

const MAX_VALUES = 50;

const MAX_PROJECT_REPOS = 400;

function isDraft(value: unknown): value is Draft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as Partial<Draft>;
  return (
    draft.version === 6 &&
    typeof draft.id === 'string' &&
    typeof draft.index === 'number' &&
    typeof draft.furthest === 'number' &&
    typeof draft.saves === 'number' &&
    Array.isArray(draft.access) &&
    Array.isArray(draft.picked) &&
    (draft.help === null || typeof draft.help === 'string') &&
    (draft.revision === null ||
      (typeof draft.revision === 'object' &&
        Array.isArray(draft.revision.projects) &&
        Array.isArray(draft.revision.seen)))
  );
}

function readDraft(path: string): Draft | null {
  if (!existsSync(path)) return null;
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (isDraft(value)) return value;
  } catch (error) {
    log.warn('[Onboarding] The saved setup could not be read; starting again', {
      path,
      error: describeError(error),
    });
    return null;
  }
  log.warn('[Onboarding] The saved setup is not one Shinsa wrote; starting again', { path });
  return null;
}

function parseStepId(value: unknown, steps: readonly StepDefinition[]) {
  const step = steps.find((entry) => entry.id === value);
  if (!step) throw new DomainError('step_invalid', 'Name a setup step.');
  return step.id;
}

function isProjectChoice(value: unknown): value is OnboardingProjectChoice {
  if (!value || typeof value !== 'object') return false;
  const choice = value as Partial<OnboardingProjectChoice>;
  return (
    typeof choice.id === 'string' &&
    typeof choice.name === 'string' &&
    Array.isArray(choice.repos) &&
    choice.repos.length <= MAX_PROJECT_REPOS &&
    choice.repos.every((repo) => typeof repo === 'string')
  );
}

function parseProjectChoices(value: unknown) {
  if (value === undefined) return null;
  if (!Array.isArray(value) || value.length > MAX_VALUES || !value.every(isProjectChoice)) {
    throw new DomainError('projects_invalid', 'Send each project as its id, name and repositories.');
  }
  return value;
}

function parseOnboardingReply(fields: JsonObject, steps: readonly StepDefinition[]): OnboardingReply {
  if (fields.type === 'restart') return { type: 'restart' };
  if (fields.type === 'open') return { type: 'open', stepId: parseStepId(fields.stepId, steps) };
  if (fields.type === 'help') return { type: 'help', stepId: parseStepId(fields.stepId, steps) };
  if (fields.type === 'answer') {
    const stepId = parseStepId(fields.stepId, steps);
    const { values } = fields;
    if (
      !Array.isArray(values) ||
      values.length === 0 ||
      values.length > MAX_VALUES ||
      !values.every((value) => typeof value === 'string')
    ) {
      throw new DomainError('values_invalid', 'Pick at least one option.');
    }
    const projects = parseProjectChoices(fields.projects);
    return { type: 'answer', stepId, values: values as string[], ...(projects ? { projects } : {}) };
  }
  if (fields.type === 'revise') {
    const stepId = parseStepId(fields.stepId, steps);
    if (typeof fields.text !== 'string') throw new DomainError('request_invalid', 'Say what to change.');
    const projects = parseProjectChoices(fields.projects);
    return { type: 'revise', stepId, text: fields.text, ...(projects ? { projects } : {}) };
  }
  throw new DomainError('reply_invalid', 'Answer a step, open one, ask for help or start again.');
}

export class OnboardingSetup {
  readonly #options: FlowOptions;
  #draft: Draft | null = null;
  #tail: Promise<unknown> = Promise.resolve();

  constructor(options: FlowOptions) {
    this.#options = options;
  }

  resolve(): Promise<OnboardingFlow> {
    return this.#serial(async () => this.#present(this.#open()));
  }

  selectHelp(): Promise<string | null> {
    return this.#serial(async () => this.#open().help);
  }

  reply(fields: JsonObject): Promise<OnboardingFlow> {
    return this.#serial(async () => {
      const reply = parseOnboardingReply(fields, this.#options.steps);
      if (reply.type === 'restart') return this.#present(this.#start());
      const draft = this.#open();
      const index = this.#options.steps.findIndex((step) => step.id === reply.stepId);
      if (reply.type === 'open') {
        this.#assertReached(draft, index);
        this.#move(draft, index);
        return this.#present(draft);
      }
      if (index !== draft.index) {
        throw new DomainError('step_stale', 'That step has closed.');
      }
      if (reply.type === 'help') {
        await this.#help(draft, this.#options.steps[index] as StepDefinition);
        return this.#present(draft);
      }
      if (reply.type === 'revise') {
        await this.#revise(draft, reply.stepId, reply.text, reply.projects);
        return this.#present(draft);
      }
      await this.#answer(draft, reply.stepId, reply.values, reply.projects);
      return this.#present(draft);
    });
  }

  #serial<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(work);
    this.#tail = result.then(
      () => null,
      () => null
    );
    return result;
  }

  #open(): Draft {
    this.#draft ??= readDraft(this.#options.path);
    const draft = this.#draft;
    if (!draft) return this.#start();
    const finished = draft.index >= this.#options.steps.length;
    if (finished && !this.#options.isCompleted()) return this.#start();
    return draft;
  }

  #start(): Draft {
    const draft: Draft = {
      version: 6,
      id: Bun.randomUUIDv7(),
      index: 0,
      furthest: 0,
      saves: 0,
      revisit: this.#options.isCompleted(),
      problem: null,
      access: [],
      picked: [],
      revision: null,
      help: null,
    };
    this.#draft = draft;
    this.#write(draft);
    return draft;
  }

  #assertReached(draft: Draft, index: number) {
    if (draft.index >= this.#options.steps.length) {
      throw new DomainError('setup_finished', 'Setup is done. Restart it in Settings.');
    }
    if (!draft.revisit && index > draft.furthest) {
      throw new DomainError('step_unreached', 'Answer the steps before this one first.');
    }
  }

  #move(draft: Draft, index: number) {
    draft.index = index;
    draft.furthest = Math.max(draft.furthest, index);
    draft.problem = null;
    draft.access = [];
    draft.picked = [];
    this.#write(draft);
  }

  async #revise(
    draft: Draft,
    stepId: OnboardingStepId,
    text: string,
    projects: OnboardingProjectChoice[] | undefined
  ) {
    if (stepId !== 'projects') {
      throw new DomainError('revise_invalid', 'Only suggested projects can change.');
    }
    try {
      draft.revision = await this.#options.reviseProjects(draft.revision, text, projects);
      draft.problem = null;
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      draft.problem = error.message;
    }
    this.#write(draft);
  }

  async #help(draft: Draft, definition: StepDefinition) {
    const context = this.#options.resolveContext(draft.revision);
    const view = await definition.view(context, false, draft.picked);
    const failing = listFailingChecks(view.checks);
    if (failing.length === 0) {
      throw new DomainError(
        'help_unneeded',
        'Every check on this step passes, so there is nothing to ask about.'
      );
    }
    draft.help = await this.#options.requestHelp(failing);
    this.#write(draft);
  }

  async #answer(
    draft: Draft,
    stepId: OnboardingStepId,
    values: string[],
    projects: OnboardingProjectChoice[] | undefined
  ) {
    const step = this.#options.steps[draft.index] as StepDefinition;
    const context = this.#options.resolveContext(draft.revision);
    const commandId = `setup:${draft.id}:${stepId}:${draft.saves}`;
    try {
      await step.answer(
        values,
        {
          ...context,
          save: (patch) => context.save(patch, commandId),
          createProjects: (choices) => context.createProjects(choices, commandId),
        },
        projects
      );
    } catch (error) {
      if (!(error instanceof DomainError)) throw error;
      const refused = error instanceof PrivateFoldersError;
      draft.problem = refused ? null : error.message;
      draft.access = refused ? error.folders : [];
      draft.picked = refused ? error.picked : [];
      this.#write(draft);
      return;
    }
    draft.saves += 1;
    if (draft.index === this.#options.steps.length - 1) await this.#options.complete();
    this.#move(draft, draft.index + 1);
  }

  #write(draft: Draft) {
    if (this.#options.readOnly) return;
    writeJsonFile(this.#options.path, draft);
  }

  async #present(draft: Draft): Promise<OnboardingFlow> {
    const { steps } = this.#options;
    const context = this.#options.resolveContext(draft.revision);
    const definition = steps[draft.index];
    const entries = await Promise.all(
      steps.map(async (step, index) => ({
        id: step.id,
        label: step.label,
        summary: await this.#summarize(draft, step, index, context),
        reached: draft.revisit || index <= draft.furthest,
      }))
    );
    return {
      steps: entries,
      index: draft.index,
      step: await this.#view(draft, definition, context),
      revisit: draft.revisit,
      welcome: this.#options.selectWelcome(),
    };
  }

  #summarize(draft: Draft, step: StepDefinition, index: number, context: StepReadContext) {
    const answered = draft.revisit || index < draft.furthest;
    if (!answered || index === draft.index) return Promise.resolve(null);
    return step.summarize(context);
  }

  async #view(
    draft: Draft,
    definition: StepDefinition | undefined,
    context: StepReadContext
  ): Promise<OnboardingStep | null> {
    if (!definition) return null;
    const answered = draft.revisit || draft.index < draft.furthest;
    const view = await definition.view(context, answered, draft.picked);
    return {
      id: definition.id,
      ...view,
      conversation: definition.id === 'projects' ? (draft.revision?.turns ?? []) : [],
      problem: draft.problem,
      access: draft.access,
      help: draft.help,
    };
  }
}
