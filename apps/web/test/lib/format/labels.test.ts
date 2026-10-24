import { describe, expect, it } from 'bun:test';
import { TASK_PRIORITIES } from '@shinsa/core';
import {
  AGENT_STAGES,
  listPriorityItems,
  PRIORITY_ICON,
  PRIORITY_LABEL,
  STAGE_ICON,
  STAGE_LABEL,
  STAGE_TONE,
} from '@/lib/format/labels.ts';

describe('stage labels', () => {
  it('calls decisions by what you do at them', () => {
    expect(STAGE_LABEL.awaiting_plan).toBe('Plan to approve');
    expect(STAGE_LABEL.awaiting_review).toBe('Changes to review');
    expect(STAGE_LABEL.awaiting_merge).toBe('Ready to merge');
    expect(STAGE_LABEL.queued).toBe('Not started');
  });

  it('gives decisions their status tone and working stages blue', () => {
    expect(STAGE_TONE.awaiting_plan).toBe('purple');
    expect(STAGE_TONE.awaiting_review).toBe('amber');
    expect(STAGE_TONE.awaiting_merge).toBe('green');
    for (const stage of AGENT_STAGES) {
      expect(stage === 'triage' ? 'neutral' : 'blue').toBe(STAGE_TONE[stage]);
    }
  });

  it('only counts stages an agent runs in as working', () => {
    expect(AGENT_STAGES.has('building')).toBe(true);
    expect(AGENT_STAGES.has('awaiting_review')).toBe(false);
    expect(AGENT_STAGES.has('merged')).toBe(false);
    expect(STAGE_ICON.building).toBe('IconHammer');
    expect(STAGE_ICON.merged).toBeUndefined();
  });
});

describe('priorities', () => {
  it('gives every priority a label and an icon', () => {
    for (const priority of TASK_PRIORITIES) {
      expect(PRIORITY_LABEL[priority]).toBeTruthy();
      expect(PRIORITY_ICON[priority].name).toStartWith('IconPriority');
    }
    expect(PRIORITY_ICON.urgent.className).toContain('text-red-4');
  });

  it('lists the priority choices from most to least urgent', () => {
    expect(listPriorityItems().map((item) => [item.value, item.label])).toEqual([
      ['urgent', 'Urgent'],
      ['high', 'High priority'],
      ['normal', 'Normal priority'],
      ['low', 'Low priority'],
    ]);
  });
});
