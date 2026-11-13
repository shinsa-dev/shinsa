import { Clock, Effect, Option, Schema } from 'effect';
import {
  resolveCurrentRound,
  resolveSlackEscalationFollowUp,
  type ShinsaState,
  SLACK_RELAY_PATHS,
  type SlackMessage,
  SlackRelayNotify,
  serializeSlackEscalation,
  serializeSlackEscalationCleared,
  type Task,
  type Watchdog,
} from '../../packages/core/src/index.ts';
import { HOUR, MINUTE } from '../kit/time.ts';
import { parseRequestBody, readBearerMachine } from './requests.ts';
import { type Machine, SANDBOX_PATH, USER } from './schema.ts';

export const SLACK_PAGE = `${SANDBOX_PATH}/slack`;

const WORKSPACE = { teamId: 'T02SUPERWALL', teamName: 'Overclock' };

const CHANNELS = [
  { id: 'C07ONCALL', name: 'oncall' },
  { id: 'C0RELEASES', name: 'releases' },
  { id: 'C0LEADS', name: 'leads' },
];

const REFUSING_CHANNEL = 'C0LEADS';

const PEOPLE = [
  { id: 'U04MAYA', name: 'Maya Chen', image: 'https://avatars.githubusercontent.com/u/9919?s=72' },
  { id: 'U0KAI', name: 'Kai Tanaka', image: 'https://avatars.githubusercontent.com/u/1342004?s=72' },
  { id: 'U0RIO', name: 'Rio Alvarez' },
  { id: 'U0MONA', name: USER.name ?? 'Mona Lisa' },
];

interface Posted {
  channelId: string;
  ts: string;
  threadTs: string | null;
  message: SlackMessage;
  postedAt: number;
  editedAt: number | null;
}

const posts: Posted[] = [];

let sequence = 0;

const decodeNotify = Schema.decodeUnknownEffect(Schema.fromJsonString(SlackRelayNotify));

function resolveConversation(kind: string, id: string) {
  return kind === 'slack_person' ? `D${id}` : id;
}

function describeConversation(channelId: string) {
  const channel = CHANNELS.find((entry) => entry.id === channelId);
  if (channel) return `#${channel.name}`;
  const person = PEOPLE.find((entry) => `D${entry.id}` === channelId);
  return person ? `Direct message to ${person.name}` : channelId;
}

function record(channelId: string, threadTs: string | null, message: SlackMessage, now: number) {
  sequence += 1;
  const ts = `${Math.floor(now / 1000)}.${String(sequence).padStart(6, '0')}`;
  posts.push({ channelId, ts, threadTs, message, postedAt: now, editedAt: null });
  return { channelId, ts };
}

function refuse(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status });
}

const respondNotify = Effect.fn('Sandbox.respondSlackNotify')(function* (request: Request) {
  const notify = yield* parseRequestBody(request, decodeNotify);
  const now = yield* Clock.currentTimeMillis;
  if (notify.replace) {
    const { channelId, ts } = notify.replace;
    const found = posts.find((post) => post.channelId === channelId && post.ts === ts);
    if (!found) return refuse(403, 'post_not_yours', 'That message was not posted by this machine.');
    found.message = notify.message as SlackMessage;
    found.editedAt = now;
    return Response.json(notify.replace);
  }
  if (notify.reply) {
    const { channelId, threadTs } = notify.reply;
    if (!posts.some((post) => post.channelId === channelId && post.ts === threadTs))
      return refuse(403, 'post_not_yours', 'That thread was not started by this machine.');
    return Response.json(record(channelId, threadTs, notify.message as SlackMessage, now));
  }
  if (notify.id === REFUSING_CHANNEL)
    return refuse(
      502,
      'slack_failed',
      'The Shinsa app is not in that channel. Invite it with /invite @Shinsa.'
    );
  return Response.json(
    record(resolveConversation(notify.kind, notify.id), null, notify.message as SlackMessage, now)
  );
});

export const respondSandboxSlack = Effect.fn('Sandbox.respondSlack')(function* (
  request: Request,
  url: URL,
  studio: Machine | undefined
) {
  if (!url.pathname.startsWith('/__remote/slack/')) return null;
  if (!studio || readBearerMachine(request) !== studio.id)
    return Response.json({ links: [] }, { status: url.pathname === SLACK_RELAY_PATHS.links ? 200 : 403 });
  if (url.pathname === SLACK_RELAY_PATHS.links)
    return Response.json({ links: [{ ...WORKSPACE, userId: 'U0MONA', userName: USER.name, linkedAt: 0 }] });
  if (url.pathname === SLACK_RELAY_PATHS.directory)
    return Response.json({ teamId: WORKSPACE.teamId, channels: CHANNELS, people: PEOPLE });
  if (url.pathname === SLACK_RELAY_PATHS.notify) return yield* respondNotify(request);
  return Response.json({ ok: true });
});

export const seedSlackSamples = Effect.fn('Sandbox.seedSlackSamples')(function* (
  state: ShinsaState,
  taskUrl: (taskId: string) => string
) {
  const now = yield* Clock.currentTimeMillis;
  const base = Object.values(state.tasks).find((task) => task.pullRequest) ?? Object.values(state.tasks)[0];
  if (!base) return;
  const escalation = {
    at: now - 20 * MINUTE,
    reason: 'Urgent, and ready to merge.',
    handoff: {
      waitedMinutes: 0,
      ownerActiveAt: now - 3 * HOUR,
      foundBy: null,
      ratings: { confidence: 'high' as const, risk: 'low' as const },
      mergesAt: now + 40 * MINUTE,
      blockedBy: null,
    },
  };
  const open: Task = { ...base, escalation };
  const url = taskUrl(base.id);
  record(`D${PEOPLE[0]?.id}`, null, serializeSlackEscalation(open, escalation, url), now - 20 * MINUTE);
  const pullRequest = base.pullRequest ?? {
    number: 412,
    url: 'https://github.com/overclock/shinsa/pull/412',
    checks: 'passing' as const,
    unresolvedComments: 0,
    mergeable: true,
    updatedAt: now,
  };
  const watchdog: Watchdog = {
    id: 'sandbox-watchdog',
    round: resolveCurrentRound(base).number,
    title: 'Checkout errors',
    check: 'Errors on POST /checkout stay under 1 in 1,000.',
    source: null,
    sourceRequest: null,
    firstCheckMinutes: 30,
    maxGapMinutes: 360,
    forMinutes: 4320,
    startsOn: 'merge',
    productionCheck: null,
    status: 'watching',
    armedAt: now - 90 * MINUTE,
    awaitingSince: null,
    startedAt: now - 90 * MINUTE,
    endsAt: null,
    nextCheckAt: now + 30 * MINUTE,
    runId: null,
    checks: [],
    forkTaskIds: [],
    linkedTaskIds: [],
    endedAt: null,
  };
  const merged: Task = {
    ...base,
    escalation: null,
    pullRequest: { ...pullRequest, state: 'merged' },
    watchdogs: [watchdog],
  };
  const root = record('C07ONCALL', null, serializeSlackEscalationCleared(merged, url), now - 2 * HOUR);
  const followUp = resolveSlackEscalationFollowUp({ ...state, tasks: { [base.id]: merged } }, base.id, url);
  if (Option.isSome(followUp)) record('C07ONCALL', root.ts, followUp.value, now - 90 * MINUTE);
});

function escapeHtml(text: string) {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

const SHORT_TIME = new Intl.DateTimeFormat([], { timeStyle: 'short' });

const SHORT_DATE = new Intl.DateTimeFormat([], { dateStyle: 'medium', timeStyle: 'short' });

function renderPlain(text: string) {
  const decoded = text.replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&amp;', '&');
  return escapeHtml(decoded).replace(/\*([^*\n]+)\*/g, '<b>$1</b>');
}

function renderToken(token: string) {
  const [target = '', label = target] = token.split('|');
  if (target.startsWith('!date')) return escapeHtml(SHORT_DATE.format(Date.parse(label)));
  return `<a href="${escapeHtml(target)}" target="_blank">${renderPlain(label)}</a>`;
}

function renderLine(line: string) {
  const quoted = line.startsWith('&gt; ');
  const parts = (quoted ? line.slice(5) : line).split(/<([^>]+)>/);
  const html = parts.map((part, index) => (index % 2 === 1 ? renderToken(part) : renderPlain(part))).join('');
  return quoted ? `<span class="quote">${html}</span>` : html;
}

function renderMrkdwn(text: string) {
  return text.split('\n').map(renderLine).join('<br>');
}

type Block = Record<string, unknown>;

function readText(value: unknown) {
  return typeof value === 'object' && value !== null && 'text' in value ? String(value.text) : '';
}

function renderBlock(block: Block) {
  switch (block.type) {
    case 'header':
      return `<div class="header">${escapeHtml(readText(block.text))}</div>`;
    case 'section': {
      const fields = Array.isArray(block.fields) ? block.fields : [];
      const body = block.text ? `<div>${renderMrkdwn(readText(block.text))}</div>` : '';
      const grid = fields.map((field) => `<div>${renderMrkdwn(readText(field))}</div>`).join('');
      return `${body}${grid ? `<div class="fields">${grid}</div>` : ''}`;
    }
    case 'context': {
      const elements = Array.isArray(block.elements) ? block.elements : [];
      return `<div class="context">${elements.map((element) => renderMrkdwn(readText(element))).join(' · ')}</div>`;
    }
    case 'actions': {
      const elements = Array.isArray(block.elements) ? (block.elements as Block[]) : [];
      const buttons = elements.map(
        (element) =>
          `<a class="button${element.style === 'primary' ? ' primary' : ''}" href="${escapeHtml(String(element.url ?? '#'))}" target="_blank">${escapeHtml(readText(element.text))}</a>`
      );
      return `<div class="actions">${buttons.join('')}</div>`;
    }
    case 'divider':
      return '<hr>';
    default:
      return '';
  }
}

function renderPost(post: Posted) {
  const time = SHORT_TIME.format(post.postedAt);
  const edited = post.editedAt ? ' <span class="muted">(edited)</span>' : '';
  const blocks = (post.message.blocks as Block[]).map(renderBlock).join('');
  return `<div class="post"><div class="avatar">S</div><div class="body"><div><b>Shinsa</b> <span class="app">APP</span> <span class="muted">${time}</span>${edited}</div>${blocks}</div></div>`;
}

export function serializeSlackPage() {
  const conversations = [...new Set(posts.map((post) => post.channelId))];
  const sections = conversations.map((channelId) => {
    const roots = posts.filter((post) => post.channelId === channelId && post.threadTs === null);
    const threads = roots.map((root) => {
      const replies = posts.filter((post) => post.channelId === channelId && post.threadTs === root.ts);
      const thread =
        replies.length > 0
          ? `<div class="thread"><div class="muted">${replies.length === 1 ? '1 reply' : `${replies.length} replies`}</div>${replies.map(renderPost).join('')}</div>`
          : '';
      return `${renderPost(root)}${thread}`;
    });
    return `<section><h2>${escapeHtml(describeConversation(channelId))}</h2>${threads.reverse().join('')}</section>`;
  });
  const empty = '<p class="muted">Nothing posted yet. Send a test from Settings → Agents → Autopilot.</p>';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Slack, stood in</title><meta http-equiv="refresh" content="5"><style>
body{font:15px/1.46 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1d1c1d;max-width:760px;margin:32px auto;padding:0 16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px;padding-bottom:6px;border-bottom:1px solid #e8e8e8}
.muted{color:#616061;font-size:12px}.post{display:flex;gap:8px;padding:8px 0}.avatar{width:36px;height:36px;border-radius:6px;background:#1264a3;color:#fff;display:grid;place-items:center;font-weight:700;flex-shrink:0}
.body{min-width:0;flex:1}.app{font-size:10px;background:#e8e8e8;color:#616061;border-radius:3px;padding:1px 3px;font-weight:700}
.header{font-weight:900;font-size:18px;margin:6px 0 4px}.fields{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin:8px 0}
.context{color:#616061;font-size:12px;margin-top:6px}.actions{margin:10px 0 4px;display:flex;gap:8px}
.button{border:1px solid #ccc;border-radius:4px;padding:3px 12px;font-weight:700;font-size:13px;color:#1d1c1d;text-decoration:none}
.button.primary{background:#007a5a;border-color:#007a5a;color:#fff}.quote{border-left:4px solid #ddd;padding-left:10px;display:inline-block}
a{color:#1264a3}.thread{margin-left:44px;border-left:2px solid #e8e8e8;padding-left:12px}
</style></head><body><h1>Slack, stood in</h1><p class="muted">What Shinsa posted to the ${escapeHtml(WORKSPACE.teamName)} workspace, drawn as Slack draws it. #leads refuses posts, to try a failure. The page refreshes every 5 seconds.</p>${sections.join('') || empty}</body></html>`;
}
