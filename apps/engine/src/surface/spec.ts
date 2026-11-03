import { Effect } from 'effect';
import { describeMark, PLAIN_DISPLAY } from '../terminal/index.ts';
import type { Values } from './fields.ts';
import type {
  ActionDefinition,
  CommandDefinition,
  CommandReceipt,
  ReadDefinition,
  SurfaceClient,
  SurfaceSpec,
} from './schema.ts';

export type { SurfaceSpec } from './schema.ts';

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
    run: Effect.fn('Surface.command')(function* (client, values, display = PLAIN_DISPLAY) {
      const built = definition.build(values, client);
      const command = Effect.isEffect(built) ? yield* built : built;
      const receipt = yield* client.send(command);
      const done = describeMark(
        display.style,
        'success',
        'check',
        definition.done?.(values, receipt) ?? 'Done.'
      );
      const problem = definition.after?.(values, receipt, client) ?? null;
      const link = describeTaskLink(client, receipt);
      const text = [done, problem, link ? display.style.dim(link) : null].filter(Boolean).join('\n');
      return { data: receipt, text };
    }),
  };
}

export function defineRead<T>(definition: ReadDefinition<T>): SurfaceSpec {
  return {
    path: definition.path,
    summary: definition.summary,
    fields: definition.fields,
    access: 'read',
    ...(definition.humanOnly ? { humanOnly: true } : {}),
    run: Effect.fn('Surface.read')(function* (client, values, display = PLAIN_DISPLAY) {
      const data = yield* definition.read(values, client);
      return { data, text: definition.format(data, values, display) };
    }),
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
