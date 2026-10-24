import { describe, expect, it } from 'bun:test';
import { describeSecretAsk, describeSecretPlaceholder } from '@/lib/overview/secret.ts';

describe('the secret card’s words', () => {
  it('names the secret the agent asked for, and asks you to paste it', () => {
    expect(describeSecretAsk('Stripe test key')).toBe('The agent asked for the Stripe test key');
    expect(describeSecretPlaceholder('Stripe test key')).toBe('Paste the Stripe test key');
  });
});
