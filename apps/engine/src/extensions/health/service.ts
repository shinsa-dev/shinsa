import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { Context, Duration, Effect, Layer, type Scope } from 'effect';
import { describeError } from '../../log/redact.ts';
import {
  type McpCheckedStatus,
  type McpDefinition,
  McpServerFailed,
  SIGN_IN_REFUSED,
  STDERR_LIMIT,
} from '../schema.ts';
import { isUnauthorized, listToolInfo, sumToolTokens } from '../tools.ts';

export class McpClients extends Context.Service<
  McpClients,
  {
    open(
      definition: McpDefinition,
      timeout: Duration.Input
    ): Effect.Effect<{ client: Client; stderr: () => string }, McpServerFailed, Scope.Scope>;
    request<A>(run: () => Promise<A>, timeout: Duration.Input): Effect.Effect<A, McpServerFailed>;
    check(definition: McpDefinition, timeout: Duration.Input): Effect.Effect<McpCheckedStatus>;
  }
>()('shinsa/engine/extensions/health/McpClients') {
  static readonly layer = Layer.sync(McpClients, () => {
    const request = <A>(run: () => Promise<A>, timeout: Duration.Input) =>
      Effect.tryPromise({
        try: run,
        catch: (error) =>
          new McpServerFailed({ message: describeError(error), unauthorized: isUnauthorized(error) }),
      }).pipe(
        Effect.timeoutOrElse({
          duration: timeout,
          orElse: () =>
            Effect.fail(
              new McpServerFailed({
                message: `No answer within ${Duration.toSeconds(timeout)} seconds.`,
                unauthorized: false,
              })
            ),
        })
      );

    const readProcessEnv = () =>
      Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
      );

    const createTransport = (definition: McpDefinition): { transport: Transport; stderr: () => string } => {
      if (definition.transport === 'stdio') {
        const transport = new StdioClientTransport({
          command: definition.command ?? '',
          args: definition.args,
          env: { ...readProcessEnv(), ...definition.env },
          ...(definition.cwd ? { cwd: definition.cwd } : {}),
          stderr: 'pipe',
        });
        let output = '';
        transport.stderr?.on('data', (chunk: Buffer) => {
          output = `${output}${chunk.toString()}`.slice(-STDERR_LIMIT);
        });
        return { transport, stderr: () => output.trim() };
      }
      const url = new URL(definition.url ?? '');
      const requestInit = { headers: definition.headers };
      const transport =
        definition.transport === 'sse'
          ? new SSEClientTransport(url, { requestInit })
          : new StreamableHTTPClientTransport(url, { requestInit });
      return { transport, stderr: () => '' };
    };

    const open = Effect.fn('McpClients.open')(function* (definition: McpDefinition, timeout: Duration.Input) {
      const client = yield* Effect.acquireRelease(
        Effect.sync(() => new Client({ name: 'shinsa', version: '1.0.0' })),
        (opened) =>
          Effect.tryPromise(() => opened.close()).pipe(
            Effect.catch((error) =>
              Effect.logWarning('[Extensions] Could not close an MCP connection').pipe(
                Effect.annotateLogs({ transport: definition.transport, error: describeError(error.cause) })
              )
            )
          )
      );
      const opened = yield* Effect.try({
        try: () => createTransport(definition),
        catch: (error) => new McpServerFailed({ message: describeError(error), unauthorized: false }),
      });
      yield* request(() => client.connect(opened.transport), timeout).pipe(
        Effect.mapError((failed) => {
          const stderr = opened.stderr();
          return stderr ? new McpServerFailed({ ...failed, message: `${failed.message} ${stderr}` }) : failed;
        })
      );
      return { client, stderr: opened.stderr };
    });

    const check = Effect.fn('McpClients.check')(function* (
      definition: McpDefinition,
      timeout: Duration.Input
    ) {
      return yield* Effect.scoped(
        Effect.gen(function* () {
          const { client } = yield* open(definition, timeout);
          const listed = yield* request(() => client.listTools(), timeout);
          return {
            state: 'connected',
            error: null,
            tools: listToolInfo(listed.tools),
            tokens: sumToolTokens(listed.tools),
          } satisfies McpCheckedStatus;
        })
      ).pipe(
        Effect.catchTag('McpServerFailed', (failed) =>
          Effect.succeed<McpCheckedStatus>(
            failed.unauthorized
              ? { state: 'needs_sign_in', error: SIGN_IN_REFUSED, tools: [], tokens: null }
              : { state: 'failing', error: failed.message, tools: [], tokens: null }
          )
        )
      );
    });

    return McpClients.of({ open, request, check });
  });
}
