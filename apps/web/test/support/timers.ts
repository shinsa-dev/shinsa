import { jest } from 'bun:test';
import { act } from '@testing-library/react';

export function restoreRealTimers() {
  if (!jest.isFakeTimers()) return;
  act(() => {
    jest.advanceTimersByTime(0);
  });
  jest.useRealTimers();
}
