import type { FixReply, Gate, Iteration, ShinsaState, Task } from '@shinsa/core';
import { createSampleGate, createSampleState, createSampleTask, HOUR, MINUTE } from './samples.ts';

export interface ExchangesScene {
  state: ShinsaState;
  review: Task;
  gate: Gate;
  working: Task;
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

const SETTINGS_REPLY_REPORT: FixReply = {
  headline: SETTINGS_HEADLINE,
  points: [
    {
      ask: 'Move Slack from Integrations to where Remote access is',
      outcome: 'done',
      note: 'Settings → General, right below Remote access.',
    },
    {
      ask: 'Guide me through testing it end to end',
      outcome: 'done',
      note: 'Three steps under What to do now, and an engine already running on this branch.',
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
  details: SETTINGS_REPLY,
};

const STATUS_REPLY_REPORT: FixReply = {
  headline: STATUS_HEADLINE,
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
  details: STATUS_REPLY,
};

function answered(id: string, text: string, reply: FixReply, at: number, repliedAt: number): Iteration {
  return { id, round: 1, requests: [{ text, comments: 0, at }], reply, runId: null, repliedAt };
}

function listIterations(now: number): Iteration[] {
  return [
    answered('settings', SETTINGS_REQUEST, SETTINGS_REPLY_REPORT, now - 2 * HOUR, now - HOUR - 40 * MINUTE),
    answered('status', STATUS_REQUEST, STATUS_REPLY_REPORT, now - 38 * MINUTE, now - 14 * MINUTE),
  ];
}

export function createExchangesScene(now: number): ExchangesScene {
  const iterations = listIterations(now);
  const review = createSampleTask(now, {
    id: 'slack',
    title: 'Add native Slack integration via Socket Mode',
    stage: 'awaiting_review',
    stageReason: 'waiting for your review',
    iterations,
    plan: {
      version: 2,
      body: '',
      document: null,
      proposedAt: now - 6 * HOUR,
      changeSummary:
        'The bot is one Slack app on app.shinsa.dev on the Events API, reaching each machine over its tunnel.',
      feedback:
        'Use the Events API on app.shinsa.dev instead of Socket Mode, so one shared bot works for everyone.',
      approvedAt: now - 5 * HOUR,
    },
  });
  const working = createSampleTask(now, {
    id: 'slack-working',
    title: 'Add native Slack integration via Socket Mode',
    stage: 'fixing',
    stageReason: 'working on your request',
    iterations: [
      ...iterations,
      {
        id: 'rename',
        round: 1,
        requests: [
          {
            text: 'Rename the Slack section to "Slack" and drop "(beta)" from it.',
            comments: 2,
            at: now - 3 * MINUTE,
          },
        ],
        reply: null,
        runId: null,
        repliedAt: null,
      },
    ],
  });
  const gate = createSampleGate(now, {
    id: 'slack-review',
    taskId: review.id,
    type: 'review',
    title: 'Review the Slack integration',
    openedAt: now - 12 * MINUTE,
  });
  return { state: createSampleState({ tasks: [review, working], gates: [gate] }), review, gate, working };
}
