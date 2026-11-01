import { type ChatTool, resolveAnsweredReply, type Task } from '@shinsa/core';
import type { ToolCall } from '@/lib/chat/timeline.ts';
import { describeTool } from '@/lib/chat/tool-describe.ts';

function createSampleCall(key: string, tool: ChatTool, overrides: Partial<ToolCall> = {}): ToolCall {
  return {
    key,
    callId: key,
    tool,
    description: describeTool(tool),
    result: 'Done.',
    images: [],
    failed: false,
    recovery: null,
    ...overrides,
  };
}

const PLAN: ChatTool = {
  kind: 'shinsa',
  name: 'propose_plan',
  args: {
    goal: 'Split the repositories into projects by owner.',
    phases: [{ title: 'Create the projects', detail: 'One project per owner, each with its folder.' }],
  },
};

export function createSampleRevisionCall(task: Task) {
  const document = task.plan?.document;
  return createSampleCall('revised', {
    kind: 'shinsa',
    name: 'propose_plan',
    args: {
      goal: document?.goal ?? '',
      phases: (document?.phases ?? []).map((phase) => ({ title: phase.title, detail: phase.detail })),
    },
  });
}

export function createSampleChatCalls() {
  return {
    work: [
      createSampleCall('read', { kind: 'read', path: 'docs/engine.md', range: null }),
      createSampleCall('ls', {
        kind: 'command',
        action: 'run',
        command: 'ls ~/Developer',
        description: null,
      }),
    ],
    retried: createSampleCall('rejected', PLAN, {
      failed: true,
      recovery: 'retried',
      result:
        'Shinsa rejected this hand-over. Fix these and call the tool again:\n- phases[0].detail is 172 characters; the limit is 160.',
    }),
    failed: createSampleCall('failed', PLAN, {
      failed: true,
      result: 'Shinsa rejected this hand-over. Fix these and call the tool again:\n- goal is missing.',
    }),
    ask: createSampleCall(
      'ask',
      {
        kind: 'shinsa',
        name: 'ask',
        args: {
          question: 'How should I group your repositories?',
          choices: ['Shinsa’s projects (group my repos)', 'One project for everything'],
        },
      },
      { result: resolveAnsweredReply('Shinsa’s projects (group my repos)', false) }
    ),
    reshape: createSampleCall('reshape', {
      kind: 'shinsa',
      name: 'reshape_task',
      args: { reason: 'This only changes Shinsa’s settings.', steps: ['plan', 'operate'] },
    }),
  };
}
