import { spyOn } from 'bun:test';
import { type EngineInfo, resolveEngineInfo } from '@shinsa/core';
import { connection } from '@/lib/connection/socket.ts';
import { addTeardown } from './teardown.ts';

export function spyOnEngine(engine: EngineInfo | null = resolveEngineInfo('1.0.0')) {
  const spy = spyOn(connection, 'selectEngine').mockReturnValue(engine);
  addTeardown(() => spy.mockRestore());
  return spy;
}
