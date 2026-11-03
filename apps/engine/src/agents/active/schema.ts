import type { RunAccount } from '@shinsa/core';
import type { Fiber } from 'effect';
import type { AccountLease } from '../accounts.ts';
import type { RunClock } from '../clock.ts';
import type { Delivery } from '../delegations/schema.ts';
import type { AgentSession } from '../providers/index.ts';

export interface ActiveRun {
  taskId: string;
  done: Promise<void>;
  fiber: Fiber.Fiber<unknown, unknown> | null;
  session: AgentSession | null;
  clock: RunClock | null;
  attemptId: string | null;
  attempts: number;
  lease: AccountLease | null;
  rejected: string[];
  renewed: string[];
  renewing: RunAccount | null;
  overloads: number;
  wake: (() => void) | null;
  steerable: boolean;
  leaseSpent: boolean;
  stopping: boolean;
  queued: string[];
  unsent: string[];
  resteered: string[];
  unsteered: string[];
  delegated: boolean;
  delivery: Delivery | null;
  held: Delivery[];
  steered: Map<string, string[]>;
  released: boolean;
}
