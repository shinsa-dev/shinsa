import type { ShinsaToolName, UserCommand } from '@shinsa/core';
import { type Display, describeMark, PLAIN_DISPLAY } from '../terminal/index.ts';
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
  run: (client: SurfaceClient, values: Values, display?: Display) => Promise<SurfaceResult>;
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
  format: (data: T, values: Values, display: Display) => string;
}

interface ActionDefinition {
  path: readonly string[];
  summary: string;
  fields: FieldSpec[];
  humanOnly?: boolean;
  act: (client: SurfaceClient, values: Values, display: Display) => Promise<SurfaceResult>;
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
    run: async (client, values, display = PLAIN_DISPLAY) => {
      const receipt = await client.send(await definition.build(values, client));
      const done = describeMark(
        display.style,
        'success',
        'check',
        definition.done?.(values, receipt) ?? 'Done.'
      );
      const link = describeTaskLink(client, receipt);
      return { data: receipt, text: link ? `${done}\n${display.style.dim(link)}` : done };
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
    run: async (client, values, display = PLAIN_DISPLAY) => {
      const data = await client.read<T>(await definition.request(values, client));
      return { data, text: definition.format(data, values, display) };
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
    run: (client, values, display = PLAIN_DISPLAY) => definition.act(client, values, display),
  };
}

export function readValue(values: Values, name: string) {
  const value = values[name];
  return typeof value === 'string' ? value : '';
}

export function encode(value: unknown) {
  return encodeURIComponent(String(value));
}
