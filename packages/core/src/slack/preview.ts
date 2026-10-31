import {
  createSlackContext,
  createSlackHeader,
  createSlackMessage,
  createSlackSection,
  type SlackMessage,
} from './blocks.ts';
import {
  SLACK_REACTIONS,
  type SlackReaction,
  type SlackTaskRef,
  serializeSlackDeclined,
  serializeSlackForwardedView,
  serializeSlackHeldView,
  serializeSlackLinkPrompt,
  serializeSlackOffline,
  serializeSlackPlanView,
  serializeSlackProposalView,
  serializeSlackQuestionView,
  serializeSlackResultView,
  serializeSlackReviewView,
  serializeSlackSecretView,
  serializeSlackStatusView,
} from './messages.ts';

export interface SlackPreviewPost {
  name: string;
  message: SlackMessage;
}

const PREVIEW_REQUEST = /^preview posts[.!]?$/i;

export const SLACK_PREVIEW_REACTIONS: SlackReaction[] = [
  SLACK_REACTIONS.sizing,
  SLACK_REACTIONS.working,
  SLACK_REACTIONS.needsYou,
  SLACK_REACTIONS.done,
];

export function isSlackPreviewRequest(text: string) {
  return PREVIEW_REQUEST.test(text.trim());
}

const PREVIEW_RESULT = [
  'The status line posts twice because two `slack.status` effects for the same task can run before the first one records where it posted.',
  '',
  '**Where it happens**',
  '- `apps/engine/src/slack/index.ts` reads `link.statusTs` before it posts.',
  '- A gate opening and a stage change in one command each queue a status.',
  '',
  '> Both runs see no status yet, so both post a new message.',
  '',
  '```ts',
  'let ts = await this.#send(link, link.statusTs, message);',
  '```',
  '',
  'Running the status effects of one task in order fixes it.',
].join('\n');

export function serializeSlackPreviewIntro(posts: readonly SlackPreviewPost[]) {
  return createSlackMessage('Every post Shinsa makes in a thread, with sample data.', [
    createSlackHeader('Every post Shinsa makes in a thread'),
    createSlackSection(posts.map((post, index) => `*${index + 1}.*  ${post.name}`).join('\n')),
    createSlackContext([
      'Sample data, in this order. The reaction on your message steps through each state. The question’s buttons answer nothing.',
    ]),
  ]);
}

export function listSlackPreviewPosts(origin: string, connectUrl: string): SlackPreviewPost[] {
  const ref: SlackTaskRef = {
    label: 'LOC-90 · Fix the doubled Slack status line',
    url: origin,
    pullRequest: null,
  };
  const shipped: SlackTaskRef = {
    ...ref,
    pullRequest: { number: 128, url: 'https://github.com/shinsa-dev/shinsa/pull/128' },
  };
  return [
    {
      name: 'Status: sizing up the work',
      message: serializeSlackStatusView(ref, { label: 'Sizing up the work', detail: null }),
    },
    {
      name: 'Status: working',
      message: serializeSlackStatusView(ref, { label: 'Building phase 2 of 3', detail: null }),
    },
    {
      name: 'Status: needs you',
      message: serializeSlackStatusView(ref, {
        label: 'Needs you',
        detail: 'Which wording should the footer use?',
      }),
    },
    {
      name: 'Status: with a pull request',
      message: serializeSlackStatusView(shipped, { label: 'Merged', detail: null }),
    },
    {
      name: 'Question',
      message: serializeSlackQuestionView(ref, {
        gateId: 'preview',
        question: 'Which wording should the footer use?',
        context: 'The page has room for one short line under the download button.',
        choices: ['Hand over the work. Keep the decisions.', 'Made for people who review their agents.'],
        recommendation: 'Hand over the work. Keep the decisions.',
      }),
    },
    { name: 'Secret', message: serializeSlackSecretView(ref, 'Slack signing secret') },
    {
      name: 'Plan',
      message: serializeSlackPlanView(ref, {
        goal: 'Post one status line per task and edit it in place, even when two updates land at once.',
        phases: [
          'Run a task’s status updates in order',
          'Cover the race with a test',
          'Write it into the docs',
        ],
      }),
    },
    {
      name: 'Review',
      message: serializeSlackReviewView(shipped, {
        summary:
          'Status updates of one task now run in order, so the line is edited instead of posted twice.',
        checks: 'All 3 checks passed.',
      }),
    },
    {
      name: 'Proposed change',
      message: serializeSlackProposalView(
        ref,
        'Run the status effects of one task in order, in `apps/engine/src/slack`.'
      ),
    },
    { name: 'Result', message: serializeSlackResultView(ref, PREVIEW_RESULT) },
    { name: 'Sent to the task', message: serializeSlackForwardedView(ref) },
    { name: 'Kept for the task', message: serializeSlackHeldView(ref) },
    { name: 'Not a task', message: serializeSlackDeclined() },
    { name: 'Not connected (only the sender sees it)', message: serializeSlackLinkPrompt(connectUrl) },
    { name: 'Machine offline', message: serializeSlackOffline('Christo’s MacBook Pro') },
  ];
}
