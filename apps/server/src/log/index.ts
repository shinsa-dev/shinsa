type Fields = Record<string, unknown>;

type Level = 'info' | 'warn' | 'error';

const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@"]+@/gi;

const TOKENS = /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{20,})/g;

export function redactSecrets(text: string) {
  return text.replace(URL_CREDENTIALS, '$1***@').replace(TOKENS, '***');
}

export function describeError(error: unknown) {
  return redactSecrets(error instanceof Error ? error.message : String(error));
}

function write(level: Level, message: string, fields?: Fields) {
  const line = redactSecrets(JSON.stringify({ at: new Date().toISOString(), level, message, ...fields }));
  const stream = level === 'error' ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}

export const log = {
  info: (message: string, fields?: Fields) => write('info', message, fields),
  warn: (message: string, fields?: Fields) => write('warn', message, fields),
  error: (message: string, fields?: Fields) => write('error', message, fields),
};
