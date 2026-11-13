import {
  AGENT_ROLES,
  type AgentRole,
  CLAUDE_PROVIDER,
  type ProviderLoginStatus,
  type Settings,
} from '@shinsa/core';
import { Option, Schema } from 'effect';
import { ProviderChoice } from '../config/machine/schema.ts';

const decodeChoice = Schema.decodeUnknownOption(ProviderChoice);

export function parseProviderChoice(value: unknown) {
  return decodeChoice(value);
}

export function isProviderShown(choice: ProviderChoice | undefined, status: ProviderLoginStatus | null) {
  if (choice === 'removed') return false;
  if (choice === 'added') return true;
  return status === 'signed_in';
}

export function resolveProviderReset(settings: Settings, provider: string): Option.Option<Partial<Settings>> {
  const given = settings.agentProviders ?? {};
  const moved = AGENT_ROLES.filter((role) => given[role] === provider);
  const defaultMoved = settings.defaultProvider === provider;
  if (moved.length === 0 && !defaultMoved) return Option.none();
  const kept: Partial<Record<AgentRole, string>> = {};
  for (const role of AGENT_ROLES) {
    const id = given[role];
    if (id !== undefined && id !== provider) kept[role] = id;
  }
  return Option.some({
    ...(moved.length > 0 ? { agentProviders: kept } : {}),
    ...(defaultMoved ? { defaultProvider: CLAUDE_PROVIDER } : {}),
  });
}
