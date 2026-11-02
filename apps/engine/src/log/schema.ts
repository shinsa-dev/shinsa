import type { LogLevel } from 'effect';

export type LogFields = Record<string, unknown>;

export type LogLevelName = 'info' | 'warn' | 'error';

export const LOG_LEVEL_NAMES: Record<LogLevel.LogLevel, LogLevelName> = {
  All: 'info',
  Trace: 'info',
  Debug: 'info',
  Info: 'info',
  Warn: 'warn',
  Error: 'error',
  Fatal: 'error',
  None: 'info',
};

export const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@"]+@/gi;

export const SECRET_TOKENS =
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{20,})/g;
