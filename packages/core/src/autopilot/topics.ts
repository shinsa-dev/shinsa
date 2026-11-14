import { DAY_MS } from '../domain/index.ts';
import {
  AUTOPILOT_PROFILE_LIMITS,
  AUTOPILOT_TOPIC_LIMITS,
  AUTOPILOT_TOPICS,
  type AutopilotDecision,
  type AutopilotDecisionAnswer,
  type AutopilotDecisionKind,
  type AutopilotFollowUpMatch,
  type AutopilotProfile,
  type AutopilotTopic,
  type AutopilotTopicTally,
} from './schema.ts';
import { TOPIC_PATTERNS } from './topic-patterns.ts';

export const AUTOPILOT_TOPIC_LABEL: Record<AutopilotTopic, string> = {
  security: 'security',
  migrations: 'migrations',
  data_loss: 'data loss',
  tests: 'tests',
  errors: 'error handling',
  performance: 'performance',
  compatibility: 'compatibility',
  concurrency: 'concurrency',
  privacy: 'privacy',
  docs: 'docs',
};

const PROBED_ANSWERS: readonly AutopilotDecisionAnswer[] = ['revised', 'replied'];

const PROBED_KINDS: readonly AutopilotDecisionKind[] = ['plan', 'question', 'review', 'merge', 'proposal'];

const TOPIC_PATTERN: Record<AutopilotTopic, RegExp> = Object.fromEntries(
  AUTOPILOT_TOPICS.map((topic) => [
    topic,
    new RegExp(`(?<![a-z0-9])(?:${TOPIC_PATTERNS[topic].join('|')})(?![a-z0-9])`, 'i'),
  ])
) as Record<AutopilotTopic, RegExp>;

export function listNoteTopics(note: string | null): AutopilotTopic[] {
  if (!note) return [];
  return AUTOPILOT_TOPICS.filter((topic) => TOPIC_PATTERN[topic].test(note));
}

export function isProbingDecision(decision: Pick<AutopilotDecision, 'kind' | 'answer'>) {
  return PROBED_KINDS.includes(decision.kind) && PROBED_ANSWERS.includes(decision.answer);
}

function resolveDecay(elapsed: number) {
  const halfLife = AUTOPILOT_PROFILE_LIMITS.halfLifeDays * DAY_MS;
  return elapsed <= 0 ? 1 : 0.5 ** (elapsed / halfLife);
}

export function countDecisionTopics(
  tallies: readonly AutopilotTopicTally[],
  decision: AutopilotDecision
): AutopilotTopicTally[] {
  if (!isProbingDecision(decision)) return [...tallies];
  const topics = listNoteTopics(decision.note);
  if (topics.length === 0) return [...tallies];
  const byTopic = new Map(tallies.map((tally) => [tally.topic, tally]));
  for (const topic of topics) {
    const tally = byTopic.get(topic) ?? { topic, total: 0, recent: 0, at: decision.at };
    byTopic.set(topic, {
      topic,
      total: tally.total + 1,
      recent: tally.recent * resolveDecay(decision.at - tally.at) + 1,
      at: Math.max(tally.at, decision.at),
    });
  }
  return AUTOPILOT_TOPICS.flatMap((topic) => {
    const tally = byTopic.get(topic);
    return tally ? [tally] : [];
  });
}

export function isFollowUpScored(
  decision: Pick<AutopilotDecision, 'guess' | 'followUp' | 'answer' | 'note'>
) {
  return (
    decision.guess === 'revise' &&
    decision.followUp !== null &&
    decision.answer === 'revised' &&
    listNoteTopics(decision.note).length > 0
  );
}

export function scoreFollowUp(
  match: AutopilotFollowUpMatch,
  decision: Pick<AutopilotDecision, 'guess' | 'followUp' | 'answer' | 'note'>
): AutopilotFollowUpMatch {
  if (!isFollowUpScored(decision)) return match;
  const yours = listNoteTopics(decision.note);
  const raised = listNoteTopics(decision.followUp);
  const matched = raised.some((topic) => yours.includes(topic));
  return { scored: match.scored + 1, matched: match.matched + (matched ? 1 : 0) };
}

export function listAutopilotTopics(profile: Pick<AutopilotProfile, 'topics'> | undefined) {
  return [...(profile?.topics ?? [])]
    .filter((tally) => tally.total >= AUTOPILOT_TOPIC_LIMITS.least)
    .sort((a, b) => b.recent - a.recent || b.total - a.total)
    .slice(0, AUTOPILOT_TOPIC_LIMITS.prompt);
}

export function listAutopilotTopicLines(profile: Pick<AutopilotProfile, 'topics'> | undefined) {
  const topics = listAutopilotTopics(profile);
  if (topics.length === 0) return [];
  const named = topics.map((tally) => `${AUTOPILOT_TOPIC_LABEL[tally.topic]} (${tally.total})`).join(', ');
  return [
    `Topics they raise most when they ask for changes or reply, the ones raised lately first: ${named}.`,
    'When the work touches one of these and does not settle it, a follow-up on it is what they would ask.',
  ];
}
