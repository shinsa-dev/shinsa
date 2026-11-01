import { spyOn } from 'bun:test';
import { type EngineInfo, resolveEngineInfo } from '@shinsa/core';
import { connection } from '@/lib/connection/socket.ts';

export function spyOnEngine(engine: EngineInfo | null = resolveEngineInfo('1.0.0')) {
  return spyOn(connection, 'selectEngine').mockReturnValue(engine);
}
