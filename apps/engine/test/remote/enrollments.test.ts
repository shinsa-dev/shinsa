import { describe, expect, test } from 'bun:test';
import { createEnrollProof } from '@shinsa/core';
import { ENROLLMENT_TTL_MS, Enrollments } from '../../src/remote/enrollments.ts';

const KEYS = { machine: 'm', device: 'd', clientEphemeral: 'e' };

describe('enrollments', () => {
  test('redeem a proof made with a live secret exactly once, giving the link and name it was made for', async () => {
    const enrollments = new Enrollments(() => 0);
    const { id, secret, expiresAt } = enrollments.create('iPhone');
    expect(expiresAt).toBe(ENROLLMENT_TTL_MS);
    expect(enrollments.create('iPhone').id).not.toBe(id);
    const proof = await createEnrollProof(secret, KEYS);
    expect(await enrollments.redeem(proof, { ...KEYS, device: 'other' })).toBeNull();
    expect(await enrollments.redeem(proof, KEYS)).toEqual({ id, name: 'iPhone' });
    expect(await enrollments.redeem(proof, KEYS)).toBeNull();
  });

  test('refuse a secret once it expired or was cleared', async () => {
    let now = 0;
    const enrollments = new Enrollments(() => now);
    const expired = await createEnrollProof(enrollments.create('iPhone').secret, KEYS);
    now = ENROLLMENT_TTL_MS;
    expect(await enrollments.redeem(expired, KEYS)).toBeNull();
    const cleared = await createEnrollProof(enrollments.create('iPhone').secret, KEYS);
    enrollments.clear();
    expect(await enrollments.redeem(cleared, KEYS)).toBeNull();
  });

  test('keep only the last few secrets', async () => {
    const enrollments = new Enrollments();
    const first = await createEnrollProof(enrollments.create('iPhone').secret, KEYS);
    for (let index = 0; index < 5; index++) enrollments.create('iPhone');
    expect(await enrollments.redeem(first, KEYS)).toBeNull();
  });
});
