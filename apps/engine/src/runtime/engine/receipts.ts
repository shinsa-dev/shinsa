import type { ShinsaCommand } from '@shinsa/core';
import type { ReceiptInput } from '../../store/receipts/schema.ts';
import { TARGET_FIELDS } from './schema.ts';

export function resolveReceiptIdentity(command: ShinsaCommand, id: string): ReceiptInput {
  const fields = command as Partial<Record<(typeof TARGET_FIELDS)[number], unknown>>;
  const name = TARGET_FIELDS.find((field) => typeof fields[field] === 'string');
  return {
    id,
    type: command.type,
    target: name ? `${name}:${String(fields[name])}` : '*',
    fingerprint: Bun.hash(JSON.stringify(command)).toString(36),
  };
}
