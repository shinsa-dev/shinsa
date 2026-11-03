import { Context, Effect, Logger, LogLevel, References } from 'effect';

export class WorkerContext extends Context.Service<
  WorkerContext,
  { readonly waitUntil: (work: Promise<unknown>) => void }
>()('shinsa/cloud/http/WorkerContext') {}

export class Assets extends Context.Service<
  Assets,
  { readonly fetch: (request: Request) => Promise<Response> }
>()('shinsa/cloud/http/Assets') {}

export const deferWork = Effect.fn('deferWork')(function* <R>(work: Effect.Effect<void, never, R>) {
  const services = yield* Effect.context<R>();
  const worker = yield* WorkerContext;
  worker.waitUntil(Effect.runPromiseWith(services)(work));
});

function writeConsole(level: LogLevel.LogLevel, message: unknown, detail: Record<string, unknown>) {
  const [text, ...rest] = Array.isArray(message) ? message : [message];
  const fields = rest.length > 0 ? { ...detail, detail: rest } : detail;
  // oxlint-disable-next-line eslint/no-console -- Workers Logs keeps what a Worker writes to the console, its only log
  if (LogLevel.isGreaterThanOrEqualTo(level, 'Error')) return console.error(text, fields);
  // oxlint-disable-next-line eslint/no-console -- Workers Logs keeps what a Worker writes to the console, its only log
  if (LogLevel.isGreaterThanOrEqualTo(level, 'Warn')) return console.warn(text, fields);
  // oxlint-disable-next-line eslint/no-console -- Workers Logs keeps what a Worker writes to the console, its only log
  return console.log(text, fields);
}

export const WorkerLogger = Logger.layer([
  Logger.make(({ logLevel, message, fiber }) =>
    writeConsole(logLevel, message, fiber.getRef(References.CurrentLogAnnotations))
  ),
]);
