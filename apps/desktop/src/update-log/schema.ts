import { Schema } from 'effect';

export const UPDATE_LOG = { file: 'updater.log', previous: 'updater.old.log', limit: 1_000_000 };

export const LogLevel = Schema.Literals(['debug', 'info', 'warn', 'error']);

export type LogLevel = typeof LogLevel.Type;
