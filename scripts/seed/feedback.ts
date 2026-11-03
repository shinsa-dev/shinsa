import type { Feedback, ShinsaEventInput } from '../../packages/core/src/index.ts';
import { DAY, MINUTE } from '../kit/time.ts';
import { NOW } from './kit.ts';

function createSeedFeedback(at: number, id: string, overrides: Partial<Feedback>): Feedback {
  return {
    id,
    source: 'human',
    note: '',
    title: null,
    body: null,
    status: 'draft',
    failure: null,
    issue: null,
    taskId: null,
    runId: null,
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

const SEED_ENVIRONMENT = [
  '- Shinsa: 0.42.0 (3f9c2e1), the Mac app',
  '- System: macOS (Darwin 25.1.0), arm64',
  '- Runtime: Bun 1.3.4',
  '- Default agent: claude, claude-opus-5-5',
];

function serializeSeedIssue(sections: [string, string[]][], environment: string[]) {
  return [
    ...sections.flatMap(([heading, lines]) => [`### ${heading}`, '', ...lines, '']),
    '### Environment',
    '',
    ...SEED_ENVIRONMENT,
    ...environment,
  ].join('\n');
}

export function pushSeedFeedback(push: (at: number, event: ShinsaEventInput) => void) {
  const entries = [
    createSeedFeedback(NOW - 3 * DAY, 'feedback-filed', {
      note: 'The usage menu should say when my limit resets, not only how much is left.',
      title: 'Show when a usage limit resets in the usage menu',
      body: serializeSeedIssue(
        [
          [
            'Summary',
            ['The usage menu shows how much of each usage limit is used, but never when the limit resets.'],
          ],
          [
            'Where in Shinsa',
            [
              'The usage menu in the header, opened from the usage meter, with a task paused on a usage limit.',
            ],
          ],
          [
            'What happened',
            [
              'The menu lists each account’s limits as percentages. A task paused on a usage limit says it waits for the reset, and nothing on screen says when that is.',
            ],
          ],
          [
            'What should happen',
            [
              'Each limit shows its reset time beside the percentage, such as “Resets at 14:00”, in the local time zone.',
            ],
          ],
          [
            'Steps to reproduce',
            [
              '1. Use an account until one of its limits is nearly used up.',
              '2. Open the usage menu in the header.',
              '3. Look for when the limit resets: only the percentage is shown.',
            ],
          ],
          [
            'Why it matters',
            [
              'Without the reset time it is unclear whether to switch accounts or wait, so paused tasks sit longer than they need to.',
            ],
          ],
          [
            'Suggested change',
            [
              'Show the reset time each provider reports with its usage, in each limit’s row of the usage menu.',
            ],
          ],
          [
            'Acceptance criteria',
            [
              '- [ ] Every limit in the usage menu shows when it resets.',
              '- [ ] The time is in the local time zone.',
              '- [ ] A limit whose provider reports no reset time shows no time rather than a wrong one.',
            ],
          ],
        ],
        ['- Sent by: the person using Shinsa']
      ),
      status: 'filed',
      issue: {
        number: 214,
        url: 'https://github.com/shinsa-dev/shinsa/issues/214',
        openedAt: NOW - 3 * DAY,
        closedAt: null,
      },
    }),
    createSeedFeedback(NOW - 6 * DAY, 'feedback-closed', {
      source: 'agent',
      note: 'report_review refused my findings because one file path had a leading ./ before it.',
      title: 'Review hand-over refuses a finding whose file path starts with ./',
      body: serializeSeedIssue(
        [
          [
            'Summary',
            [
              '`report_review` refuses the whole review when a finding names its file as `./path` instead of `path`.',
            ],
          ],
          [
            'Where in Shinsa',
            ['The agent review step, when the reviewer hands over findings with `report_review`.'],
          ],
          [
            'What happened',
            [
              'The tool answered that the finding’s file is not in the change, though it is, and the reviewer had to send every finding again.',
            ],
          ],
          ['What should happen', ['A leading `./` is read as the same path, and the review is accepted.']],
          [
            'Steps to reproduce',
            [
              '1. Open a task at its agent review.',
              '2. Have the reviewer call `report_review` with a finding whose file starts with `./`.',
            ],
          ],
          ['Why it matters', ['A review is sent twice, and its findings reach the human later.']],
          ['Suggested change', ['Normalize finding paths before checking them against the change.']],
          [
            'Acceptance criteria',
            [
              '- [ ] A finding whose file starts with `./` is accepted.',
              '- [ ] A file outside the change is still refused.',
            ],
          ],
        ],
        ['- Sent by: an agent working in Shinsa', '- Step: agent review, as the reviewer']
      ),
      status: 'filed',
      issue: {
        number: 198,
        url: 'https://github.com/shinsa-dev/shinsa/issues/198',
        openedAt: NOW - 6 * DAY,
        closedAt: NOW - 2 * DAY,
      },
    }),
    createSeedFeedback(NOW - 50 * MINUTE, 'feedback-agent', {
      source: 'agent',
      taskId: 'task-basket-sync',
      note: 'complete_phase refused my spots because one range ended past the last line of a file I had just shortened.',
      title: 'Phase hand-over refuses a spot on a file shortened in the same phase',
      body: serializeSeedIssue(
        [
          [
            'Summary',
            [
              '`complete_phase` refuses the whole hand-over when one spot’s range ends past the end of a file the phase shortened.',
            ],
          ],
          ['Where in Shinsa', ['The `complete_phase` agent tool, during a build phase of a change task.']],
          [
            'What happened',
            [
              'The agent shortened a file, then handed the phase over with a spot whose line range it had read before the edit. The range ended past the file’s new last line, and Shinsa refused the hand-over with a generic range error that named neither the spot nor the file’s length.',
            ],
          ],
          [
            'What should happen',
            [
              'The refusal names the spot, the file and its current line count, so the agent can fix that one range.',
            ],
          ],
          [
            'Steps to reproduce',
            [
              '1. In a build phase, have the agent remove lines from the end of a file.',
              '2. Call `complete_phase` with a spot on that file whose `end` is the old last line.',
              '3. The hand-over is refused with a generic error.',
            ],
          ],
          [
            'Why it matters',
            ['The agent has to guess which spot is wrong and retry, which costs a turn per guess.'],
          ],
          [
            'Suggested change',
            ['Have the spot validation report the spot’s index, its file and the file’s current length.'],
          ],
          [
            'Acceptance criteria',
            [
              '- [ ] A spot past the end of its file is refused with its index, file and the file’s line count.',
              '- [ ] The other spots in the hand-over are not reported.',
            ],
          ],
        ],
        [
          '- Sent by: an agent working in Shinsa',
          '- Kind of task: change',
          '- Stage of the task: building',
          '- Agent role: agent, working on its build step',
          '- Agent provider and model: claude, claude-opus-5-5',
        ]
      ),
    }),
    createSeedFeedback(NOW - 12 * MINUTE, 'feedback-draft', {
      note: 'I wish I could drag a task in the queue to change its priority.',
      title: 'Change a task’s priority by dragging it in the queue',
      body: serializeSeedIssue(
        [
          [
            'Summary',
            ['Changing a task’s priority takes a menu per task; dragging it in the queue would be quicker.'],
          ],
          [
            'Where in Shinsa',
            ['The queue, in its popover from the header and on Home, with several tasks waiting.'],
          ],
          [
            'What happened',
            [
              'Changing a priority takes the row’s menu: open it, pick a priority, then find the task again in the reordered queue.',
            ],
          ],
          [
            'What should happen',
            [
              'Dragging a row up or down raises or lowers its priority, and the row stays under the pointer while it moves.',
            ],
          ],
          ['Steps to reproduce', ['Not given in the feedback.']],
          ['Why it matters', ['With several tasks waiting, putting them in order takes one menu per task.']],
          [
            'Suggested change',
            [
              'Let a queue row be dragged between rows of another priority, and set its priority to theirs when it is dropped.',
            ],
          ],
          [
            'Acceptance criteria',
            [
              '- [ ] A row dropped among rows of another priority takes that priority.',
              '- [ ] The row stays under the pointer while it is dragged.',
              '- [ ] The row’s menu still changes the priority as before.',
            ],
          ],
        ],
        ['- Sent by: the person using Shinsa']
      ),
    }),
  ];
  for (const entry of entries) push(entry.createdAt, { type: 'feedback.recorded', entry });
}
