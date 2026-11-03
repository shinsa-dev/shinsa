import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { DomainError } from '@shinsa/core';
import { Schema } from 'effect';
import type { Deferred, Effect } from 'effect';
import type { AgentSession } from '../../agents/providers/types.ts';
import type { McpDefinition, McpServerFailed, OpenedClient } from '../schema.ts';

export interface DeferredServer {
  name: string;
  claudeName: string;
  definition: McpDefinition;
  tools: string[];
  tokens: number | null;
}

export interface DeferredSkill {
  name: string;
  description: string;
  path: string;
}

export interface LoadableExtensions {
  deferred: DeferredServer[];
  deferredSkills: DeferredSkill[];
  loadedNames: string[];
}

export type HotLoadSession = Pick<AgentSession, 'loadMcpServers'>;

export type OpenClient = (definition: McpDefinition) => Promise<OpenedClient>;

export class ExtensionLoadFailed extends Schema.TaggedError<
  ExtensionLoadFailed,
  { readonly brand: unique symbol }
>()('ExtensionLoadFailed', { message: Schema.String }) {}

export type LoaderFailure = ExtensionLoadFailed | McpServerFailed | DomainError;

export interface LoaderClient {
  readonly client: Pick<Client, 'listTools' | 'callTool'>;
  readonly close: Effect.Effect<void>;
}

export interface ExtensionLoaderDefinition {
  readonly extensions: LoadableExtensions;
  readonly open: ((definition: McpDefinition) => Effect.Effect<LoaderClient, ExtensionLoadFailed>) | null;
}

export type ServerLoad = Deferred.Deferred<string, LoaderFailure>;

export interface ExtensionLoaderHandle {
  readonly attach: (session: HotLoadSession) => Effect.Effect<void>;
  readonly handle: (name: string, input: Record<string, unknown>) => Effect.Effect<string, LoaderFailure>;
  readonly close: Effect.Effect<void>;
}

export const LOADER_NAME_FIELD = { type: 'string', maxLength: 128 };

export const LOADER_FILLER_WORDS: ReadonlySet<string> = new Set([
  'the',
  'a',
  'an',
  'mcp',
  'server',
  'servers',
  'skill',
  'skills',
  'plugin',
  'tools',
]);
