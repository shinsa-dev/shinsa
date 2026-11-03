import type {
  AgentModel,
  DomainError,
  OnboardingStatus,
  RootSuggestions,
  ShinsaCommand,
  ShinsaEvent,
  ShinsaState,
  TerminalInfo,
} from '@shinsa/core';
import { Duration, Schema } from 'effect';
import type { Effect } from 'effect';
import type { MachineConfig } from '../config/machine/schema.ts';
import type { JsonObject } from '../http/schema.ts';
import type { Discovery, RootSourceKind } from '../repos/schema.ts';
import type { DispatchOptions } from '../runtime/engine/schema.ts';
import type { CommandResult } from '../shell/index.ts';
import type { ClaudeAccount } from './accounts.ts';
import type { OnboardingSetupHandle } from './flow/schema.ts';
import type { InstallScripts, InstallTerminals } from './install.ts';
import type { RevisionAsk } from './revise/schema.ts';

export type CommandRunner = (
  command: string[],
  cwd: string,
  options?: { timeoutMs?: number }
) => Promise<CommandResult>;

export type PrerequisiteId = 'git' | 'brew' | 'gh' | 'claude' | 'bun' | 'codex';

export interface Prerequisite {
  id: PrerequisiteId;
  label: string;
  ok: boolean;
  detail: string;
  fix: string | null;
  command: string | null;
  optional?: boolean;
  signIn?: true;
}

export interface PrerequisiteReport {
  ready: boolean;
  checks: Prerequisite[];
}

export interface PrerequisiteNeeds {
  bun: boolean;
}

export const RevisedProject = Schema.Struct({
  name: Schema.String,
  repos: Schema.mutable(Schema.Array(Schema.String)),
});
export type RevisedProject = typeof RevisedProject.Type;

const ProjectTurn = Schema.Struct({ request: Schema.String, reply: Schema.String });

export const ProjectRevision = Schema.Struct({
  projects: Schema.mutable(Schema.Array(RevisedProject)),
  seen: Schema.mutable(Schema.Array(Schema.String)),
  turns: Schema.mutable(Schema.Array(ProjectTurn)),
});
export type ProjectRevision = typeof ProjectRevision.Type;

export const SetupDraft = Schema.Struct({
  version: Schema.Literal(6),
  id: Schema.String,
  index: Schema.Number,
  furthest: Schema.Number,
  saves: Schema.Number,
  revisit: Schema.Boolean,
  problem: Schema.NullOr(Schema.String),
  access: Schema.mutable(Schema.Array(Schema.String)),
  picked: Schema.mutable(Schema.Array(Schema.String)),
  revision: Schema.NullOr(ProjectRevision),
  help: Schema.NullOr(Schema.String),
});
export type SetupDraft = { -readonly [K in keyof typeof SetupDraft.Type]: (typeof SetupDraft.Type)[K] };

const PREREQUISITE_TIMEOUT = Duration.seconds(15);

export const PREREQUISITE_TIMEOUT_MS = Duration.toMillis(PREREQUISITE_TIMEOUT);

export class OnboardingCallFailed extends Schema.TaggedError<
  OnboardingCallFailed,
  { readonly brand: unique symbol }
>()('OnboardingCallFailed', {
  message: Schema.String,
}) {}

export type OnboardingFailure = DomainError | OnboardingCallFailed;

export const MODEL_ID = /^[\w.[\]-]{1,100}$/;

interface OnboardingRoots {
  readonly configured: Effect.Effect<string[]>;
  readonly fromEnvironment: Effect.Effect<string[]>;
  readonly kind: Effect.Effect<RootSourceKind>;
  readonly list: Effect.Effect<string[], OnboardingFailure>;
  readonly discover: (refresh: boolean) => Effect.Effect<Discovery, OnboardingFailure>;
}

interface OnboardingPaths {
  readonly home: string;
  readonly configPath: string;
  readonly dataDir: string;
  readonly userHome: string;
}

export interface OnboardingDefinition {
  readonly paths: OnboardingPaths;
  readonly inspect: boolean;
  readonly state: Effect.Effect<ShinsaState>;
  readonly engineReadOnly: Effect.Effect<boolean>;
  readonly dispatch: (
    command: ShinsaCommand,
    options: DispatchOptions
  ) => Effect.Effect<ShinsaEvent[], OnboardingFailure>;
  readonly machine: Effect.Effect<MachineConfig>;
  readonly updateMachine: (patch: Partial<Omit<MachineConfig, 'version'>>) => Effect.Effect<void>;
  readonly roots: OnboardingRoots;
  readonly login: Effect.Effect<string | null, OnboardingFailure>;
  readonly ask: RevisionAsk;
  readonly run: (
    command: string[],
    cwd: string,
    options?: { timeoutMs?: number }
  ) => Effect.Effect<CommandResult, OnboardingCallFailed>;
  readonly scripts: InstallScripts;
  readonly listModels: Effect.Effect<AgentModel[], OnboardingFailure>;
  readonly listAccounts: Effect.Effect<ClaudeAccount[], OnboardingFailure>;
  readonly terminals: InstallTerminals | null;
  readonly upsertRepo: (
    projectId: string,
    path: string,
    id: string
  ) => Effect.Effect<void, OnboardingFailure>;
  readonly refreshInstallFolders: Effect.Effect<void>;
  readonly newId: Effect.Effect<string>;
}

export interface OnboardingHandle {
  readonly setup: OnboardingSetupHandle;
  readonly resolveStatus: Effect.Effect<OnboardingStatus, OnboardingFailure>;
  readonly listSuggestions: (refresh: boolean) => Effect.Effect<RootSuggestions, OnboardingFailure>;
  readonly applySetup: (
    fields: JsonObject,
    commandId?: string
  ) => Effect.Effect<OnboardingStatus, OnboardingFailure>;
  readonly complete: Effect.Effect<OnboardingStatus, OnboardingFailure>;
  readonly openPrivacySettings: Effect.Effect<{ ok: boolean }, OnboardingCallFailed>;
  readonly resolvePrerequisites: Effect.Effect<PrerequisiteReport, OnboardingFailure>;
  readonly openInstall: (fields: JsonObject) => Effect.Effect<{ terminal: TerminalInfo }, OnboardingFailure>;
}
