import { tmpdir } from 'node:os';
import { CODEX_PROVIDER } from '@shinsa/core';
import { Clock, Context, Duration, Effect, FileSystem, Layer, Option, Schema } from 'effect';
import { STATUS_TIMEOUT } from '../../../../accounts/schema.ts';
import { describeError } from '../../../../log/redact.ts';
import { NOT_STARTED_EXIT_CODE } from '../../../../shell/schema.ts';
import { Shell } from '../../../../shell/service.ts';
import { COMPLETION_TIMEOUT_MS, ProviderCallFailed, STRUCTURED_TIMEOUT_MS } from '../../schema.ts';
import type { AgentProvider, AgentSessionInput, CompletionRequest, JsonSchema } from '../../types.ts';
import { CodexCli } from '../cli/service.ts';
import { requestAnswer } from '../complete/service.ts';
import { readLogin } from '../login/service.ts';
import { HEARTBEAT_MS } from '../mcp/schema.ts';
import { CATALOG_TIMEOUT_MS } from '../models/schema.ts';
import { makeCodexModelCatalog } from '../models/service.ts';
import { COMPACT_GRACE, type CodexSessionMode, REQUEST_TIMEOUT } from '../session/schema.ts';
import { makeCodexSession } from '../session/service.ts';
import { resolveCodexHome } from '../usage/readings.ts';
import { CodexUsageUnreachable, USAGE_TIMEOUT_MS } from '../usage/schema.ts';
import { readUsage } from '../usage/service.ts';
import { CODEX_CAPABILITIES, CodexProviderOptions } from './schema.ts';

export class CodexProvider extends Context.Service<CodexProvider, AgentProvider>()(
  'shinsa/engine/agents/providers/codex/CodexProvider'
) {
  static readonly layer = Layer.effect(
    CodexProvider,
    Effect.gen(function* () {
      const runtime = yield* CodexCli;
      const options = yield* CodexProviderOptions;
      const shell = yield* Shell;
      const withFiles = Effect.provideService(FileSystem.FileSystem, yield* FileSystem.FileSystem);
      const usage = options.usage ?? {};
      const decodeObject = Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown));
      const failed = (error: { readonly message: string }) =>
        new ProviderCallFailed({ provider: CODEX_PROVIDER, message: error.message });
      const catalog = yield* makeCodexModelCatalog({
        executable: runtime.resolveExecutable,
        env: runtime.env,
        cwd: tmpdir(),
        timeout: Duration.millis(CATALOG_TIMEOUT_MS),
      });

      const within = (ms: number | undefined, fallback: Duration.Duration) =>
        ms === undefined ? fallback : Duration.millis(ms);

      const startSession = (input: AgentSessionInput, mode: CodexSessionMode) =>
        makeCodexSession({
          input,
          mode,
          executable: runtime.resolveExecutable,
          env: runtime.env,
          now: Clock.currentTimeMillis,
          requestTimeout: within(options.requestTimeoutMs, REQUEST_TIMEOUT),
          compactGrace: within(options.compactGraceMs, COMPACT_GRACE),
          heartbeat: Duration.millis(options.heartbeatMs ?? HEARTBEAT_MS),
          token: Effect.sync(() => crypto.randomUUID()),
        }).pipe(
          Effect.map((handle) => ({
            done: handle.done,
            steer: (text: string, from: 'you' | 'shinsa' = 'you') => handle.steer(text, from),
            cancel: handle.cancel,
          }))
        );

      const answer = (request: CompletionRequest, schema: JsonSchema | null, timeoutMs: number) =>
        requestAnswer({
          executable: runtime.resolveExecutable,
          env: runtime.env,
          cwd: tmpdir(),
          request,
          schema,
          timeout: Duration.millis(timeoutMs),
        }).pipe(Effect.mapError(failed));

      const request = usage.requestHttp ?? fetch;

      return CodexProvider.of({
        id: CODEX_PROVIDER,
        label: 'Codex',
        capabilities: CODEX_CAPABILITIES,
        startSession: (input) => startSession(input, 'turns'),
        compactSession: (input) => startSession({ ...input, prompt: '' }, 'compact'),
        listModels: catalog.list,
        complete: (completion) => answer(completion, null, COMPLETION_TIMEOUT_MS),
        completeStructured: (structured) =>
          answer(structured, structured.schema, structured.timeoutMs ?? STRUCTURED_TIMEOUT_MS).pipe(
            Effect.map((text) => (text ? Option.getOrNull(decodeObject(text)) : null))
          ),
        readLogin: readLogin({
          executable: runtime.resolveExecutable,
          status: (path) =>
            shell
              .run({
                argv: [path, 'login', 'status'],
                cwd: tmpdir(),
                timeout: STATUS_TIMEOUT,
                env: runtime.env,
              })
              .pipe(
                Effect.catchTag('CommandNotFound', (missing) =>
                  Effect.succeed({
                    ok: false,
                    code: NOT_STARTED_EXIT_CODE,
                    stdout: '',
                    stderr: missing.message,
                    timedOut: false,
                  })
                )
              ),
        }),
        readUsage: withFiles(
          readUsage({
            home: resolveCodexHome({ ...Bun.env, ...(usage.env ?? runtime.env) }),
            now: Clock.currentTimeMillis,
            requestHttp: (url, init) =>
              Effect.tryPromise({
                try: (signal) => request(url, { ...init, signal }),
                catch: (error) => new CodexUsageUnreachable({ message: describeError(error) }),
              }),
            executable: runtime.resolveExecutable,
            env: runtime.env,
            cwd: tmpdir(),
            timeout: Duration.millis(usage.timeoutMs ?? USAGE_TIMEOUT_MS),
          })
        ).pipe(Effect.mapError(failed)),
      });
    })
  );
}
