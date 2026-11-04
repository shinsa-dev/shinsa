import { Logger, LogLevel, References } from 'effect';

function writeConsole(level: LogLevel.LogLevel, message: unknown, detail: Record<string, unknown>) {
  const [text, ...rest] = Array.isArray(message) ? message : [message];
  const fields = rest.length > 0 ? { ...detail, detail: rest } : detail;
  // oxlint-disable-next-line eslint/no-console -- Workers Logs keeps what a Worker writes to the console, its only log
  if (LogLevel.isGreaterThanOrEqualTo(level, 'Error')) return console.error(text, fields);
  // oxlint-disable-next-line eslint/no-console -- Workers Logs keeps what a Worker writes to the console, its only log
  return console.log(text, fields);
}

export const WorkerLogger = Logger.layer([
  Logger.make(({ logLevel, message, fiber }) =>
    writeConsole(logLevel, message, fiber.getRef(References.CurrentLogAnnotations))
  ),
]);
