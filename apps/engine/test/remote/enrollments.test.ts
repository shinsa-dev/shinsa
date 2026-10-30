import { describe, expect, test } from 'bun:test';
import { createEnrollProof } from '@shinsa/core';
import { ENROLLMENT_TTL_MS, Enrollments } from '../../src/remote/enrollments.ts';

const KEYS = { machine: 'm', device: 'd', clientEphemeral: 'e' };

describe('enrollments', () => {
  test('redeem a proof made with a live secret exactly once', async () => {
    const enrollments = new Enrollments(() => 0);
    const { secret, expiresAt } = enrollments.create();
    expect(expiresAt).toBe(ENROLLMENT_TTL_MS);
    const proof = await createEnrollProof(secret, KEYS);
    expect(await enrollments.redeem(proof, { ...KEYS, device: 'other' })).toBe(false);
    expect(await enrollments.redeem(proof, KEYS)).toBe(true);
    expect(await enrollments.redeem(proof, KEYS)).toBe(false);
  });

  test('refuse a secret once it expired or was cleared', async () => {
    let now = 0;
    const enrollments = new Enrollments(() => now);
    const expired = await createEnrollProof(enrollments.create().secret, KEYS);
    now = ENROLLMENT_TTL_MS;
    expect(await enrollments.redeem(expired, KEYS)).toBe(false);
    const cleared = await createEnrollProof(enrollments.create().secret, KEYS);
    enrollments.clear();
    expect(await enrollments.redeem(cleared, KEYS)).toBe(false);
  });

  test('keep only the last few secrets', async () => {
    const enrollments = new Enrollments();
    const first = await createEnrollProof(enrollments.create().secret, KEYS);
    for (let index = 0; index < 5; index++) enrollments.create();
    expect(await enrollments.redeem(first, KEYS)).toBe(false);
  });
});
