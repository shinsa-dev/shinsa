import type { ShinsaToolName, UserCommand } from '@shinsa/core';
import type { CommandReceipt, SurfaceClient } from './client.ts';
import type { FieldSpec, Values } from './fields.ts';

interface SurfaceResult {
  data: unknown;
  text: string;
}

type SurfaceAccess = 'read' | 'write';

export interface SurfaceSpec {
  path: readonly string[];
  summary: string;
  fields: FieldSpec[];
  access: SurfaceAccess;
  command?: UserCommand['type'];
  humanOnly?: boolean;
  agentTool?: ShinsaToolName;
  run: (client: SurfaceClient, values: Values) => Promise<SurfaceResult>;
}

interface CommandDefinition {
  path: readonly string[];
  summary: string;
  fields: FieldSpec[];
  command: UserCommand['type'];
  humanOnly?: boolean;
  agentTool?: ShinsaToolName;
  build: (values: Values, client: SurfaceClient) => UserCommand | Promise<UserCommand>;
  done?: (values: Values, receipt: CommandReceipt) => string;
}

interface ReadDefinition<T> {
  path: readonly string[];
  summary: string;
  fields: FieldSpec[];
  humanOnly?: boolean;
  request: (values: Values, client: SurfaceClient) => string | Promise<string>;
  format: (data: T, values: Values) => string;
}

interface ActionDefinition {
  path: readonly string[];
  summary: string;
  fields: FieldSpec[];
  humanOnly?: boolean;
  act: (client: SurfaceClient, values: Values) => Promise<SurfaceResult>;
}

export function describeTaskLink(client: SurfaceClient, receipt: CommandReceipt) {
  const ref = receipt.handle ?? receipt.taskId;
  return ref ? `${client.base}/tasks/${ref}` : '';
}

export function defineCommand(definition: CommandDefinition): SurfaceSpec {
  return {
    path: definition.path,
    summary: definition.summary,
    fields: definition.fields,
    access: 'write',
    command: definition.command,
    ...(definition.humanOnly ? { humanOnly: true } : {}),
    ...(definition.agentTool ? { agentTool: definition.agentTool } : {}),
    run: async (client, values) => {
      const receipt = await client.send(await definition.build(values, client));
      const done = definition.done?.(values, receipt) ?? 'Done.';
      const link = describeTaskLink(client, receipt);
      return { data: receipt, text: link ? `${done}\n${link}` : done };
    },
  };
}

export function defineRead<T>(definition: ReadDefinition<T>): SurfaceSpec {
  return {
    path: definition.path,
    summary: definition.summary,
    fields: definition.fields,
    access: 'read',
    ...(definition.humanOnly ? { humanOnly: true } : {}),
    run: async (client, values) => {
      const data = await client.read<T>(await definition.request(values, client));
      return { data, text: definition.format(data, values) };
    },
  };
}

export function defineAction(definition: ActionDefinition): SurfaceSpec {
  return {
    path: definition.path,
    summary: definition.summary,
    fields: definition.fields,
    access: 'write',
    ...(definition.humanOnly ? { humanOnly: true } : {}),
    run: definition.act,
  };
}

export function readValue(values: Values, name: string) {
  const value = values[name];
  return typeof value === 'string' ? value : '';
}

export function encode(value: unknown) {
  return encodeURIComponent(String(value));
}
