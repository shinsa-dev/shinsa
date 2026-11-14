import { describe, expect, test } from 'bun:test';
import type { AutopilotBenchmarkRow } from '../../packages/core/src/index.ts';
import { serializeBenchmark } from './report.ts';
import type { BenchmarkReplay } from './schema.ts';

function row(overrides: Partial<AutopilotBenchmarkRow>): AutopilotBenchmarkRow {
  return {
    kind: 'review',
    scope: 'all',
    track: 'model',
    scored: 40,
    agreed: 37,
    agreement: 0.925,
    loss: 0.2143,
    ...overrides,
  };
}

function replay(overrides: Partial<BenchmarkReplay> = {}): BenchmarkReplay {
  return {
    source: '/data/shinsa.sqlite',
    events: 1200,
    unreadable: 0,
    benchmark: {
      decisions: 60,
      judged: 40,
      rows: [
        row({}),
        row({ scope: 'shared', track: 'combined', scored: 12, agreed: 11, agreement: 11 / 12 }),
      ],
      followUps: { scored: 8, matched: 6 },
    },
    ...overrides,
  };
}

describe('the benchmark report', () => {
  test('says how often a follow-up raised your own topic, or that there is none yet', () => {
    expect(serializeBenchmark(replay())).toContain(
      'Follow-ups: 6 of 8 raised a topic you raised yourself (75.0%).'
    );
    const none = replay();
    const text = serializeBenchmark({
      ...none,
      benchmark: { ...none.benchmark, followUps: { scored: 0, matched: 0 } },
    });
    expect(text).toContain('Follow-ups: none to compare yet.');
  });

  test('prints each guesser per kind, the fair comparison apart, with agreement and log loss', () => {
    const text = serializeBenchmark(replay());
    expect(text).toContain('Replayed 1200 events from a copy of /data/shinsa.sqlite.');
    expect(text).toContain('40 of your 60 decisions had a guess to check.');
    expect(text).toContain('Every decision each guesser guessed');
    expect(text).toContain('Only where the model call guessed too, the fair comparison');
    expect(text).toMatch(/Reviews\s+Local model\s+40\s+92\.5%\s+0\.214/);
    expect(text).toMatch(/Reviews\s+Both combined\s+12\s+91\.7%/);
    expect(text).not.toContain('could not be read');
  });

  test('leaves out a comparison with no rows', () => {
    const text = serializeBenchmark(
      replay({
        benchmark: { decisions: 60, judged: 40, rows: [row({})], followUps: { scored: 0, matched: 0 } },
      })
    );
    expect(text).not.toContain('the fair comparison');
  });

  test('says when there is nothing to score yet, and how many events it skipped', () => {
    const text = serializeBenchmark(
      replay({
        unreadable: 3,
        benchmark: { decisions: 2, judged: 0, rows: [], followUps: { scored: 0, matched: 0 } },
      })
    );
    expect(text).toContain('3 events could not be read and were skipped.');
    expect(text).toContain('The log holds 2 decisions, and none is a plan');
    expect(text).not.toContain('Log loss');
  });

  test('says when the log holds no decisions Autopilot recorded at all', () => {
    const text = serializeBenchmark(
      replay({ benchmark: { decisions: 0, judged: 0, rows: [], followUps: { scored: 0, matched: 0 } } })
    );
    expect(text).toContain('The log holds no decisions Autopilot recorded.');
  });
});
