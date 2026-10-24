import { expect } from 'bun:test';
import { waitFor } from '@testing-library/react';

export function waitForGone(find: () => Element | null) {
  return waitFor(() => expect(find() === null, 'it is still on the screen').toBe(true));
}
