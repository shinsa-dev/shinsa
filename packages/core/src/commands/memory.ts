import type { MemoryScope } from '../domain/memory.ts';

export type MemoryUserCommand =
  | { type: 'memory.write'; memoryId: string | null; projectId: string | null; text: string }
  | { type: 'memory.accept'; memoryId: string }
  | { type: 'memory.remove'; memoryId: string };

export type MemoryAgentCommand = {
  type: 'agent.remember';
  runId: string;
  scope: MemoryScope;
  text: string;
  why: string;
};
