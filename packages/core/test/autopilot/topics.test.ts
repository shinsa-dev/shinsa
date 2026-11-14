import { describe, expect, test } from 'bun:test';
import {
  type AutopilotDecision,
  AUTOPILOT_TOPIC_LIMITS,
  DAY_MS,
  listAutopilotTopicLines,
  listAutopilotTopics,
  listNoteTopics,
  recordAutopilotDecisions,
} from '../../src/index.ts';

function decision(overrides: Partial<AutopilotDecision>): AutopilotDecision {
  return {
    at: 1,
    taskId: 't',
    gateId: 'g',
    kind: 'review',
    answer: 'revised',
    projectId: null,
    risk: null,
    scope: null,
    urgent: false,
    watchdog: false,
    touched: false,
    guess: null,
    followUp: null,
    note: null,
    facts: null,
    estimate: null,
    ...overrides,
  };
}

describe('the topics in your words', () => {
  test('finds each topic a note raises, whole words and their forms', () => {
    expect(listNoteTopics('How does this handle auth on the new endpoint?')).toEqual(['security']);
    expect(listNoteTopics('Add a migration and backfill the rows, and test it.')).toEqual([
      'migrations',
      'tests',
    ]);
    expect(listNoteTopics('Is this deleted for good? Retries could race.')).toEqual([
      'data_loss',
      'errors',
      'concurrency',
    ]);
    expect(listNoteTopics('Authenticated users only, and update the docs.')).toEqual(['security', 'docs']);
    expect(listNoteTopics('Is it slower, and does it break older versions? Mind the PII.')).toEqual([
      'performance',
      'compatibility',
      'privacy',
    ]);
  });

  test('finds nothing in words that only contain a topic', () => {
    expect(listNoteTopics('The author named a specific latest attestation.')).toEqual([]);
    expect(listNoteTopics('')).toEqual([]);
    expect(listNoteTopics(null)).toEqual([]);
  });
});

describe('the topics you probe', () => {
  test('learns them from your revise and reply notes only, at the points you decide', () => {
    const profile = recordAutopilotDecisions(undefined, [
      decision({ note: 'Check auth here.' }),
      decision({ kind: 'question', answer: 'replied', note: 'Keep the token out of logs.' }),
      decision({ kind: 'plan', note: 'Add a migration.' }),
      decision({ answer: 'approved', note: 'Auth looks fine.' }),
      decision({ kind: 'message', answer: 'sent', note: 'Auth please.' }),
      decision({ note: null }),
      decision({ note: 'Smaller, please.' }),
    ]);
    expect(profile.topics).toEqual([
      { topic: 'security', total: 2, recent: 2, at: 1 },
      { topic: 'migrations', total: 1, recent: 1, at: 1 },
    ]);
  });

  test('weighs what you raised lately most', () => {
    const later = 60 * DAY_MS;
    const profile = recordAutopilotDecisions(undefined, [
      decision({ note: 'Auth?' }),
      decision({ note: 'Auth again?' }),
      decision({ note: 'Auth, once more.' }),
      decision({ at: later, note: 'A migration?' }),
      decision({ at: later, note: 'Another migration?' }),
    ]);
    const security = profile.topics.find((tally) => tally.topic === 'security');
    expect(security?.recent).toBe(3);
    const topics = listAutopilotTopics(
      recordAutopilotDecisions(profile, [decision({ at: later, note: 'And the token?' })])
    );
    expect(topics.map((tally) => [tally.topic, tally.total])).toEqual([
      ['migrations', 2],
      ['security', 4],
    ]);
    expect(topics[1]?.recent).toBeCloseTo(3 * 0.25 + 1);
  });

  test('puts the topics raised at least twice in the judge’s words, at most five', () => {
    expect(listAutopilotTopicLines(undefined)).toEqual([]);
    const notes = [
      'Auth?',
      'Auth?',
      'Auth?',
      'Migration?',
      'Migration?',
      'Tests?',
      'Tests?',
      'Retry?',
      'Retry?',
      'Slow?',
      'Slow?',
      'Docs?',
      'Docs?',
      'PII?',
    ];
    const profile = recordAutopilotDecisions(
      undefined,
      notes.map((note, index) => decision({ at: index, note }))
    );
    expect(listAutopilotTopics(profile)).toHaveLength(AUTOPILOT_TOPIC_LIMITS.prompt);
    const [line, hint] = listAutopilotTopicLines(profile);
    expect(line).toBe(
      'Topics they raise most when they ask for changes or reply, the ones raised lately first: security (3), migrations (2), tests (2), error handling (2), performance (2).'
    );
    expect(hint).toContain('a follow-up on it is what they would ask');
  });
});
