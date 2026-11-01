import { type AgentReply, type ChatTool, resolveAnsweredReply, type Task } from '@shinsa/core';
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

const REVISION_REPLY: AgentReply = {
  headline: 'I split the work so the Overview change ships on its own, and kept the docs in the last phase.',
  points: [
    {
      ask: 'Ship the Overview change on its own',
      outcome: 'done',
      note: 'It is phase 2 now, with its own checks.',
    },
    {
      ask: 'Do we need the migration?',
      outcome: 'answered',
      note: 'Yes: old event logs still carry the plan feedback, and the migration drops it once on start.',
    },
  ],
  next: null,
};

const REPORT_REPLY: AgentReply = {
  headline: 'I added Playwright component tests to the comparison and still recommend Vitest browser mode.',
  points: [
    {
      ask: 'Compare Playwright component tests too',
      outcome: 'done',
      note: 'A fourth column in the table, with its run time on this repository.',
    },
    {
      ask: 'Which one is fastest in CI?',
      outcome: 'answered',
      note: 'Vitest browser mode, 41 seconds against 68.',
    },
  ],
  next: null,
};

export function createSampleRevisionCall(task: Task) {
  const document = task.plan?.document;
  return createSampleCall('revised', {
    kind: 'shinsa',
    name: 'propose_plan',
    args: {
      goal: document?.goal ?? '',
      phases: (document?.phases ?? []).map((phase) => ({ title: phase.title, detail: phase.detail })),
      reply: REVISION_REPLY,
    },
  });
}

export function createSampleReportCall() {
  return createSampleCall('report', {
    kind: 'shinsa',
    name: 'submit_report',
    args: {
      report:
        '**Use Vitest browser mode.** It runs the existing tests in a real browser with no new runner, and it is the fastest of the four in CI.\n\n| Tool | CI time | New runner |\n| --- | --- | --- |\n| Vitest browser mode | 41s | no |\n| Playwright component tests | 68s | yes |',
      reply: REPORT_REPLY,
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
