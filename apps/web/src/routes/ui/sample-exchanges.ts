import type { ShinsaState, Task } from '@shinsa/core';
import type { ChecksView } from '@/lib/tasks/checks.ts';
import { createChecksScene } from './sample-checks.ts';
import { createSampleState, createSampleTask, HOUR, MINUTE } from './samples.ts';

export type PointOutcome = 'done' | 'answered' | 'not_changed';

export interface SamplePoint {
  ask: string;
  outcome: PointOutcome;
  note: string;
}

export interface SampleFile {
  path: string;
  added: number;
  removed: number;
}

export interface SampleExchange {
  key: string;
  step: 'plan' | 'review';
  label: string;
  at: number;
  repliedAt: number;
  request: string;
  headline: string;
  reply: string;
  points: SamplePoint[];
  next: string | null;
  files: SampleFile[];
  checks: string;
}

export interface ExchangesScene {
  state: ShinsaState;
  task: Task;
  checks: ChecksView;
  exchanges: SampleExchange[];
}

const SETTINGS_REQUEST =
  "Um, let's remove Slack from integrations and let's rather put it where remote access is. Um because it's kind of related to it, you know what I mean? Like I would put it below the remote access stuff or like stump something like that in general in my opinion And then I also want to test this. So I can uh if you guide me through it, I can create a Slack button and everything um and I really want us to test the end to end. And Slack has really cool new Slack, like uh Slack is really cool. New primitives for agents with streaming and everything. I really want you to read into them for streaming, like messages and stuff like that, live updates, etc. And we should really utilize as much as possible um of the stuff that Slack provides us um as we can.";

const SETTINGS_HEADLINE =
  "I moved Slack under Remote access, made it use Slack's agent features, and started an engine on this branch so you can test it end to end.";

const SETTINGS_REPLY = `**Settings:** Slack is now on Settings → General, right below Remote access. While remote access is off it says "Turn it on above first". I replaced the Integrations screenshots with before and after shots of the General tab.

**Slack's agent features:**
- **Streamed reading:** when someone mentions the bot, a plan called "Reading the thread" streams into the thread with two steps, then finishes as "Starting a task" or "Nothing to start" with the reason.
- **Status message:** the task's steps now show as Slack's plan block, with done, in progress, "Waiting for you" and to come.
- **Thread status:** Slack's own working or waiting indicator on the thread follows the task.

Two things only the real test will answer: whether your workspace shows the thread status, and whether Slack lets the status message replace the finished stream.`;

const SETTINGS_NEXT = `1. At [api.slack.com/apps](https://api.slack.com/apps), create the app from \`apps/cloud/slack-manifest.json\` and turn on public distribution.
2. Put the secrets on the Worker:
   \`\`\`bash run
   cd apps/cloud && bunx wrangler secret put SLACK_CLIENT_ID && bunx wrangler secret put SLACK_TOKEN_KEY
   \`\`\`
3. Open the engine on this branch at http://127.0.0.1:61905/settings#slack, choose Connect Slack, then mention the bot in a thread.`;

const STATUS_REQUEST =
  'The status message never shows up in my workspace after I mention the bot, only the reading plan does. Also, does the thread status need something turned on in Slack?';

const STATUS_HEADLINE =
  'I fixed the status message: when Slack refuses the plan block, the thread now gets the steps as a line of text instead of nothing.';

const STATUS_REPLY = `- **App.shinsa.dev:** when Slack rejects a post's blocks (\`invalid_blocks\`), the Worker now answers with a separate refusal (422 \`slack_blocks_refused\`). It used to answer 502, which the engine retried until it gave up.
- **Engine:** on that refusal, it sends the same status again right away with the steps written out (✓ done, ● at work, ◐ waiting for you, ○ to come), and stays on text for that workspace.

**Your question:** yes. The thread status needs Agents & AI Apps turned on in the Slack app's settings. Without it Slack ignores the status, and everything else still posts.

That memory does not survive a restart: the first status after a restart tries the plan block again and falls back the same way.`;

const STATUS_NEXT =
  'Restart the engine on this branch and mention the bot again. The status message should appear as a line of steps. To see the thread status, turn on Agents & AI Apps in the Slack app first.';

function listExchanges(now: number): SampleExchange[] {
  return [
    {
      key: 'plan-2',
      step: 'plan',
      label: 'Plan v2',
      at: now - 6 * HOUR,
      repliedAt: now - 5 * HOUR - 40 * MINUTE,
      request:
        'Use the Events API on app.shinsa.dev instead of Socket Mode, so one shared bot works for everyone.',
      headline:
        'The bot is now one Slack app on app.shinsa.dev using the Events API, and it reaches each machine over its tunnel.',
      reply:
        'Phases 3 and 4 are new: the relay on app.shinsa.dev, and the engine side that takes forwarded mentions and posts back through it. Socket Mode is gone from the plan.',
      points: [
        {
          ask: 'Use the Events API on app.shinsa.dev',
          outcome: 'done',
          note: 'One shared app; mentions reach the right machine over its tunnel.',
        },
      ],
      next: null,
      files: [],
      checks: '',
    },
    {
      key: 'review-1',
      step: 'review',
      label: 'Request 1',
      at: now - 2 * HOUR,
      repliedAt: now - HOUR - 40 * MINUTE,
      request: SETTINGS_REQUEST,
      headline: SETTINGS_HEADLINE,
      reply: SETTINGS_REPLY,
      points: [
        {
          ask: 'Move Slack from Integrations to where Remote access is',
          outcome: 'done',
          note: 'Settings → General, right below Remote access.',
        },
        {
          ask: 'Guide me through testing it end to end',
          outcome: 'done',
          note: 'Three steps below, and an engine already running on this branch.',
        },
        {
          ask: "Use Slack's new agent features: streaming and live updates",
          outcome: 'done',
          note: 'Streamed reading, the plan block for the status, and the thread status.',
        },
        {
          ask: 'Replace the status message after the stream finishes',
          outcome: 'not_changed',
          note: "Slack's docs don't say whether it allows this. Your test will tell.",
        },
      ],
      next: SETTINGS_NEXT,
      files: [
        { path: 'apps/web/src/components/settings/general.tsx', added: 34, removed: 2 },
        { path: 'apps/web/src/components/settings/integrations.tsx', added: 0, removed: 41 },
        { path: 'packages/core/src/slack/blocks.ts', added: 96, removed: 18 },
        { path: 'apps/cloud/src/slack.ts', added: 52, removed: 9 },
      ],
      checks: 'All 13 checks passed',
    },
    {
      key: 'review-2',
      step: 'review',
      label: 'Request 2',
      at: now - 38 * MINUTE,
      repliedAt: now - 14 * MINUTE,
      request: STATUS_REQUEST,
      headline: STATUS_HEADLINE,
      reply: STATUS_REPLY,
      points: [
        {
          ask: 'The status message never shows up after a mention',
          outcome: 'done',
          note: 'Slack refused the plan block; the thread now gets the steps as text.',
        },
        {
          ask: 'Does the thread status need something turned on in Slack?',
          outcome: 'answered',
          note: "Yes: Agents & AI Apps in the Slack app's settings.",
        },
      ],
      next: STATUS_NEXT,
      files: [
        { path: 'apps/cloud/src/slack.ts', added: 18, removed: 4 },
        { path: 'apps/engine/src/slack/status.ts', added: 41, removed: 6 },
        { path: 'packages/core/src/slack/blocks.ts', added: 22, removed: 0 },
        { path: 'apps/engine/test/slack/status.test.ts', added: 64, removed: 0 },
        { path: 'docs/engine.md', added: 3, removed: 1 },
      ],
      checks: 'All 13 checks passed, 1 added',
    },
  ];
}

export function createExchangesScene(now: number): ExchangesScene {
  const task = createSampleTask(now, {
    id: 'slack',
    title: 'Add native Slack integration via Socket Mode',
    stage: 'awaiting_review',
    stageReason: 'waiting for your review',
  });
  const checks = createChecksScene(now);
  return {
    state: { ...checks.state, ...createSampleState({ tasks: [task] }), repos: checks.state.repos },
    task,
    checks: checks.views.passed,
    exchanges: listExchanges(now),
  };
}
