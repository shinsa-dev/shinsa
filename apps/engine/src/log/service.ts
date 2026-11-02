import { Logger, References } from 'effect';
import { ensure } from 'effect/Array';
import { redactSecrets } from './redact.ts';
import { LOG_LEVEL_NAMES } from './schema.ts';

export const JsonLogger = Logger.layer([
  Logger.make(({ date, fiber, logLevel, message }) => {
    const level = LOG_LEVEL_NAMES[logLevel];
    const fields = fiber.getRef(References.CurrentLogAnnotations);
    const text = ensure(message).map(String).join(' ');
    const line = redactSecrets(JSON.stringify({ at: date.toISOString(), level, message: text, ...fields }));
    const stream = level === 'error' ? process.stderr : process.stdout;
    stream.write(`${line}\n`);
  }),
]);
