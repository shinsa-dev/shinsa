import type { ChatEvent } from '../../packages/core/src/index.ts';

export interface ScaledTask {
  id: string;
  title: string;
  request: string;
}

export const LONG_CHAT_TASK: ScaledTask = {
  id: 'perf-long-chat',
  title: 'Long chat for performance runs',
  request: 'rebuild the settings list so it scrolls without jank on large accounts',
};

const SUBJECTS = [
  'settings list',
  'roadmap filter',
  'usage meter',
  'queue badge',
  'review card',
  'code search',
];

const VERBS = ['Fix', 'Speed up', 'Tidy', 'Rename', 'Document', 'Test'];

export function listScaledTasks(count: number): ScaledTask[] {
  return Array.from({ length: count }, (_, index) => {
    const subject = SUBJECTS[index % SUBJECTS.length];
    const verb = VERBS[Math.floor(index / SUBJECTS.length) % VERBS.length];
    return {
      id: `perf-task-${index}`,
      title: `${verb} the ${subject} (${index + 1})`,
      request: `${verb?.toLowerCase()} the ${subject}, case ${index + 1}`,
    };
  });
}

function buildSource(lines: number, seed: number) {
  return Array.from(
    { length: lines },
    (_, line) => `export function row${seed}_${line}(value: number) { return value * ${line} + ${seed}; }`
  ).join('\n');
}

function buildReply(index: number) {
  return [
    `I changed **step ${index}** in \`src/settings/list.tsx\` so the rows render once.`,
    '',
    `- The list keeps its scroll position when [TASK-${index}](shinsa://task/perf-task-${index}) updates.`,
    '- Each row is memoized on its id, so a single change re-renders one row.',
    '- `bun test` passes: 214 tests across 38 files.',
    '',
    '```ts',
    buildSource(12, index),
    '```',
    '',
    `The remaining work is the empty state, which I will cover next (see \`src/settings/empty.tsx:${index + 10}\`).`,
  ].join('\n');
}

function call(
  index: number,
  step: number,
  tool: Extract<ChatEvent, { type: 'tool_call' }>['tool']
): ChatEvent[] {
  const callId = `call-${index}-${step}`;
  const output =
    tool.kind === 'read' ? buildSource(300, step) : tool.kind === 'command' ? buildSource(200, step) : 'ok';
  return [
    { type: 'tool_call', callId, tool },
    { type: 'tool_result', callId, status: 'ok', output, images: [] },
  ];
}

export function buildLongRun(index: number, live: boolean): ChatEvent[] {
  const events: ChatEvent[] = [
    { type: 'status', status: 'started', outcome: null },
    {
      type: 'user',
      from: 'shinsa',
      text: `Work on step ${index} of the settings list.\n${buildSource(20, index)}`,
      attachments: [],
    },
  ];
  for (let step = 0; step < 6; step += 1) {
    events.push({
      type: 'agent',
      phase: 'interim',
      text: `Looking at part ${step} of the list for step ${index}.`,
    });
    events.push(
      ...call(index, step * 4, { kind: 'read', path: `src/settings/list-${step}.tsx`, range: null })
    );
    events.push(
      ...call(index, step * 4 + 1, {
        kind: 'edit',
        path: `src/settings/list-${step}.tsx`,
        hunks: [{ before: buildSource(20, step), after: buildSource(24, step + 1) }],
      })
    );
    if (step % 2 === 0) {
      events.push(
        ...call(index, step * 4 + 2, {
          kind: 'command',
          action: 'run',
          command: 'bun test',
          description: 'Run the tests',
        })
      );
    }
  }
  if (!live) {
    events.push({ type: 'agent', phase: 'final', text: buildReply(index) });
    events.push({ type: 'status', status: 'ended', outcome: 'completed' });
  }
  return events;
}
