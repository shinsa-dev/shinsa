import type { QuickJson } from '../agents/quick/index.ts';
import { type QuickAsk } from './schema.ts';

export function resolveQuickAsk(ask: QuickJson): QuickAsk {
  return <T>(system: string, prompt: string, schema: Parameters<QuickJson>[2]) =>
    ask<T>(system, prompt, schema);
}
