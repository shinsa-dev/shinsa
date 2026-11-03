import { afterEach, describe, expect, test } from 'bun:test';
import type { Changelog } from '@shinsa/core';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { startRoutes } from './harness.ts';

afterEach(disposeWebHandlers);

const CHANGELOG: Changelog = {
  releases: [
    {
      version: '1.2.0',
      date: '2026-11-03',
      changes: [{ slug: 'whats-new', kind: 'added', text: 'A What’s new button shows what changed.' }],
    },
  ],
};

describe('GET /api/changelog', () => {
  test('answers the changelog the engine carries', async () => {
    const response = await startRoutes({ changelog: CHANGELOG }).send('/api/changelog');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(CHANGELOG);
  });

  test('answers an empty changelog when the engine carries none', async () => {
    const response = await startRoutes().send('/api/changelog');
    expect(await response.json()).toEqual({ releases: [] });
  });
});
