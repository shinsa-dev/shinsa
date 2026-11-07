import { describe, expect, it } from 'bun:test';
import { AUTO_SHIP_DEFAULTS, createSettings } from '@shinsa/core';
import {
  AUTO_SHIP_RISK_ITEMS,
  describeAgentReviewNote,
  describeReviewRatings,
  isEscalationUnseen,
  listAutoShipWaitItems,
  listTeamEscalationRows,
  resolveAutoShipFact,
  resolveAutoShipValue,
  resolveEscalationFact,
} from '@/lib/auto-ship.ts';
import { createTask } from '../support/state.ts';

const FINDING = { severity: 'should_fix' as const, file: 'a.ts', line: 3, message: 'Name it.' };

describe('the Auto-ship settings', () => {
  it('reads off by default, and on with the policy you saved', () => {
    expect(resolveAutoShipValue(createSettings())).toEqual({ policy: AUTO_SHIP_DEFAULTS, enabled: 'off' });
    const settings = {
      ...createSettings(),
      autoShip: { ...AUTO_SHIP_DEFAULTS, enabled: true, merge: 'approved' as const },
    };
    expect(resolveAutoShipValue(settings)).toMatchObject({ enabled: 'on', policy: { merge: 'approved' } });
  });

  it('warns that an escalation reaches only you while no project is in a team', () => {
    const escalate = { ...AUTO_SHIP_DEFAULTS, urgent: 'escalate' as const };
    const later = { ...AUTO_SHIP_DEFAULTS, urgent: 'escalate_then_merge' as const };
    const merge = { ...AUTO_SHIP_DEFAULTS, urgent: 'merge' as const };
    expect(isEscalationUnseen(escalate, [])).toBe(true);
    expect(isEscalationUnseen(later, [{ teamIds: [] }, {}])).toBe(true);
    expect(isEscalationUnseen(escalate, [{}, { teamIds: ['team-1'] }])).toBe(false);
    expect(isEscalationUnseen(merge, [])).toBe(false);
  });

  it('names each risk limit, and never approving is not a shield', () => {
    expect(AUTO_SHIP_RISK_ITEMS.map((item) => [item.value, item.label, item.icon])).toEqual([
      ['none', 'Never', 'IconCircleX'],
      ['low', 'Low risk only', 'IconShieldCheck'],
      ['medium', 'Up to medium risk', 'IconShieldCheck'],
      ['high', 'Any risk', 'IconShieldCheck'],
    ]);
  });

  it('lists the waits in order with the one you saved, in minutes or hours', () => {
    const items = listAutoShipWaitItems({ ...AUTO_SHIP_DEFAULTS, urgentWaitMinutes: 90 });
    expect(items.map((item) => item.label)).toEqual([
      '15 minutes',
      '30 minutes',
      '1 hour',
      '90 minutes',
      '2 hours',
      '4 hours',
      '8 hours',
    ]);
    expect(items[2]).toEqual({ value: '60', label: '1 hour', icon: 'IconClock' });
  });
});

describe('what the task page says', () => {
  it('describes the reviewer’s ratings, or nothing before it rated', () => {
    expect(describeReviewRatings({ confidence: 'high', risk: 'low' })).toBe(
      'Rated high confidence, low risk.'
    );
    expect(describeReviewRatings(null)).toBeNull();
    expect(describeReviewRatings(undefined)).toBeNull();
  });

  it('says whether the review is only a signal or Auto-ship approved it', () => {
    expect(describeAgentReviewNote({ findings: [], reviewRatings: null, autoShipped: null })).toBe(
      'Found nothing to fix. A signal for you, never the approval.'
    );
    expect(
      describeAgentReviewNote({
        findings: [FINDING],
        reviewRatings: { confidence: 'high', risk: 'low' },
        autoShipped: { at: 1, reason: 'High confidence, low risk.' },
      })
    ).toBe('Found 1 should fix finding. Rated high confidence, low risk. Auto-ship approved it for you.');
  });

  it('shows Approved for you and Sent to your team with Auto-ship’s reason', () => {
    expect(resolveAutoShipFact({ autoShipped: { at: 1, reason: 'High confidence, low risk.' } })).toEqual({
      label: 'Approved for you',
      hint: 'Auto-ship approved the review: High confidence, low risk.',
    });
    expect(resolveAutoShipFact({ autoShipped: null })).toBeNull();
    expect(resolveEscalationFact({ escalation: { at: 1, reason: 'Urgent.' } })).toEqual({
      label: 'Sent to your team',
      hint: 'Auto-ship sent it to your team: Urgent.',
    });
    expect(resolveEscalationFact({})).toBeNull();
  });
});

describe('teammates’ escalated tasks in Needs you', () => {
  it('names the teammate and opens their task', () => {
    const entry = {
      task: createTask({ id: 'k-1', title: 'Fix the checkout' }),
      gates: [],
      project: null,
      repo: null,
      owner: 'kai',
      ownerProfile: { name: 'Kai Lee', avatarUrl: null },
      machine: 'Studio',
      teamId: 'core',
      instanceId: 'm-kai',
    };
    expect(listTeamEscalationRows([{ entry, escalation: { at: 5, reason: 'Urgent.' } }])).toEqual([
      {
        key: 'm-kai k-1',
        title: 'Fix the checkout',
        summary: 'Kai’s urgent change is waiting for its merge',
        since: 5,
        path: '/teams/core/m-kai/k-1',
      },
    ]);
  });
});
