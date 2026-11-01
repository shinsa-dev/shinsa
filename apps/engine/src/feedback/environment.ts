import { release } from 'node:os';
import { type Feedback, resolveTaskShape, type ShinsaState } from '@shinsa/core';
import { describeVersion, type ServerInstance } from '../instance/install.ts';

export interface FeedbackMachine {
  platform: string;
  release: string;
  arch: string;
  runtime: string;
  bundled: boolean;
}

const PLATFORM_NAMES: Record<string, string> = { darwin: 'macOS', linux: 'Linux', win32: 'Windows' };

export function resolveFeedbackMachine(bundled: boolean): FeedbackMachine {
  return {
    platform: process.platform,
    release: release(),
    arch: process.arch,
    runtime: Bun.version,
    bundled,
  };
}

function describeSystem(machine: FeedbackMachine) {
  const name = PLATFORM_NAMES[machine.platform] ?? machine.platform;
  const kernel = machine.platform === 'darwin' ? `Darwin ${machine.release}` : machine.release;
  return `${name} (${kernel}), ${machine.arch}`;
}

function describeModel(provider: string, model: string | null) {
  return model ? `${provider}, ${model}` : `${provider}, its default model`;
}

export function listFeedbackContext(state: ShinsaState, entry: Feedback): string[] {
  const run = entry.runId ? state.runs[entry.runId] : undefined;
  const task = entry.taskId ? state.tasks[entry.taskId] : undefined;
  if (entry.source !== 'agent' || !task) return [];
  return [
    `Kind of task: ${resolveTaskShape(task)}`,
    `Stage of the task: ${task.stage}`,
    ...(run ? [`Agent role: ${run.role}${run.purpose ? `, working on its ${run.purpose} step` : ''}`] : []),
    ...(run ? [`Agent provider and model: ${describeModel(run.provider, run.model)}`] : []),
  ];
}

export function listFeedbackEnvironment(
  state: ShinsaState,
  entry: Feedback,
  instance: Pick<ServerInstance, 'version' | 'commit'>,
  machine: FeedbackMachine
): string[] {
  return [
    `Shinsa: ${describeVersion(instance)}, ${machine.bundled ? 'the Mac app' : 'run from source'}`,
    `System: ${describeSystem(machine)}`,
    `Runtime: Bun ${machine.runtime}`,
    `Default agent: ${describeModel(state.settings.defaultProvider, state.settings.defaultModel)}`,
    `Sent by: ${entry.source === 'agent' ? 'an agent working in Shinsa' : 'the person using Shinsa'}`,
    ...listFeedbackContext(state, entry),
  ];
}

export function serializeFeedbackEnvironment(lines: readonly string[]) {
  return ['### Environment', '', ...lines.map((line) => `- ${line}`)].join('\n');
}
