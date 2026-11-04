import { Logger, References } from 'effect';
import { ensure } from 'effect/Array';
import { writeLogLine } from './line.ts';
import { LOG_LEVEL_NAMES } from './schema.ts';

export const JsonLogger = Logger.layer([
  Logger.make(({ date, fiber, logLevel, message }) => {
    const fields = fiber.getRef(References.CurrentLogAnnotations);
    writeLogLine(LOG_LEVEL_NAMES[logLevel], ensure(message).map(String).join(' '), fields, date);
  }),
]);
