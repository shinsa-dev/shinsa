import { describe, expect, it } from 'bun:test';
import { MINUTE_MS, type YourAttention } from '@shinsa/core';
import { listAttentionTiles } from '@/lib/stats/attention.ts';

const EMPTY: YourAttention = {
  tasksAtOnce: { median: null, peak: null },
  rounds: 0,
  inputsPerRound: { median: null, count: 0 },
  agentTimePerInput: { median: null, count: 0 },
  handsOffShare: null,
  questionShare: null,
  messagesPerRound: null,
  approvedFirstTime: { share: null, count: 0 },
};

describe('attention', () => {
  it('shows how many tasks ran at once and how little each round needed', () => {
    const tiles = listAttentionTiles({
      tasksAtOnce: { median: 3, peak: 7 },
      rounds: 12,
      inputsPerRound: { median: 2.5, count: 12 },
      agentTimePerInput: { median: 40 * MINUTE_MS, count: 12 },
      handsOffShare: 0.5,
      questionShare: 0.25,
      messagesPerRound: 0.333,
      approvedFirstTime: { share: 0.8, count: 1 },
    });
    expect(tiles.map((tile) => [tile.label, tile.value, tile.detail])).toEqual([
      ['Tasks at once', '3', 'Median while busy'],
      ['Peak at once', '7', 'At one moment'],
      ['Inputs per round', '2.5', 'Over 12 rounds'],
      ['Agent time per input', '40m', 'Over 12 rounds'],
      ['Hands-off rounds', '50%', 'Only approvals'],
      ['Rounds with a question', '25%', 'An agent asked you'],
      ['Messages per round', '0.3', 'On average, sent by you'],
      ['Approved first time', '80%', 'Over 1 review'],
    ]);
  });

  it('says None when nothing was going or finished in the range', () => {
    const tiles = listAttentionTiles(EMPTY);
    expect(tiles.map((tile) => [tile.value, tile.detail])).toEqual([
      ['None', 'No tasks going'],
      ['None', 'No tasks going'],
      ['None', 'No finished rounds'],
      ['None', 'No finished rounds'],
      ['None', 'No finished rounds'],
      ['None', 'No finished rounds'],
      ['None', 'No finished rounds'],
      ['None', 'No reviews'],
    ]);
  });
});
