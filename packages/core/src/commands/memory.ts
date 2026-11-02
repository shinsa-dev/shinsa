import type { MemoryScope } from '../domain/memory.ts';

export type MemoryAgentCommand = {
  type: 'agent.remember';
  runId: string;
  scope: MemoryScope;
  text: string;
  why: string;
};
