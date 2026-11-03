import type { ShinsaEventInput } from '../../../packages/core/src/index.ts';
import { createPlanCheck, listSeedIterations, type SeedTask } from '../kit.ts';
import { MCP_SESSION_NEW, EMBEDDED_CHAT_NEW, MCP_SESSION_TEST_NEW } from '../sources/paywall.ts';
import { spot, rangeOf, lineOf } from '../spots.ts';
import type { SeedRepos, SeedWorktrees } from '../workspace.ts';

const RECONNECT_CALL = 'Reconnect limit of 3';

export function listEmbeddedChatTasks({ paywall }: SeedRepos, worktrees: SeedWorktrees): SeedTask[] {
  const chatPath = worktrees.chat;
  const chatFile = 'src/chat/embedded-chat.ts';
  const sessionFile = 'src/chat/mcp-session.ts';
  const testFile = 'src/chat/mcp-session.test.ts';
  return [
    {
      id: 'task-embedded-chat',
      request:
        'Rework the embedded chat so it talks to MCP v2 instead of the old /chat endpoint. Tool results should show up in the conversation.',
      title: 'Run the embedded chat on MCP v2',
      repo: paywall,
      size: 'large',
      planFirst: true,
      priority: 'high',
      stage: 'awaiting_review',
      reason: 'built, checked and ready for review',
      branch: 'feat/embedded-chat-mcp',
      ageHours: 28,
      waitsOn: ['task-webhook-signing', 'task-docs-gate'],
      worktreePath: chatPath,
      addedChecks: [
        {
          label: 'Tool result rows',
          command: 'bun test src/chat/embedded-chat.test.ts',
          phases: [3, 4],
          phase: 3,
          run: 1,
          reason: 'Phase 3 renders tool results in embedded-chat.ts, which no check of the plan covered.',
        },
      ],
      checkResults: {
        c1: { detail: '6 tests, 3 new' },
        c3: { detail: '4 tests, all new' },
      },
      plan: {
        goal: 'The embedded chat sends every message through an MCP v2 session and shows tool results inline, so the chat can act on the paywall it is embedded in.',
        phases: [
          {
            title: 'Open an MCP v2 session',
            detail: 'One session per embedded chat, reconnecting with backoff.',
          },
          {
            title: 'Route messages through it',
            detail: 'Every send goes over the session instead of the old endpoint.',
          },
          {
            title: 'Render tool results inline',
            detail: 'Tool calls and their results show in the transcript.',
          },
          {
            title: 'Test reconnects',
            detail: 'Drop the connection mid-reply and confirm the draft survives.',
          },
        ],
        behaviour: [
          'Messages stream from the MCP server instead of arriving as one reply.',
          'Tool results appear as their own rows, with failures labelled.',
          'Closing the chat closes the MCP session.',
        ],
        approach:
          'Replace the fetch transport with an McpSession wrapper around the official SDK client. The chat keeps its public API; only the constructor option changes from endpoint to serverUrl.',
        files: [
          { path: chatFile, change: 'Use McpSession, record tool results, close on reset.' },
          { path: sessionFile, change: 'New: connection, reconnect limit, completion stream.' },
          { path: 'src/chat/transport.ts', change: 'Deleted; nothing else imports it.' },
        ],
        outOfScope: ['Calling paywall tools from the chat (a task that waits on this one).'],
        verification: [
          createPlanCheck('Session reconnect limit', 'bun test src/chat/mcp-session.test.ts', [1, 4]),
          createPlanCheck('Lint the chat module', 'bunx biome check src/chat', [1, 2, 3, 4]),
        ],
        questions: [],
      },
      report: {
        headline: 'The embedded chat now runs on an MCP v2 session and renders tool results inline.',
        sections: [
          {
            title: 'Open an MCP session per chat',
            summary:
              'A new McpSession owns the SDK client, connects on the first message and gives up after three failed attempts.',
            spots: [
              spot(sessionFile, MCP_SESSION_NEW, 'if (this.client) return;', 'this.attempts += 1;', 'high', {
                title: 'Connect on first use, at most three times',
                why: 'A connected session returns at once, so a client whose transport has closed is never replaced.',
                explain:
                  '`ensureConnected` is called before every send. A live `client` returns straight away. Otherwise it checks the attempt counter against `RECONNECT_LIMIT` and counts this attempt before connecting, so a failed connect still uses one up.',
              }),
              spot(
                sessionFile,
                MCP_SESSION_NEW,
                'const client = new Client({',
                'this.attempts = 0;',
                'critical',
                {
                  title: 'A good connect resets the counter',
                  why: 'The reconnect counter only resets on success. A server that drops after connecting gets three new tries each time, not three in total.',
                  explain:
                    'The SDK `Client` is built per attempt and only stored once `connect` resolves. Setting `attempts` back to 0 here makes the limit count failures in a row rather than failures over the life of the chat.',
                }
              ),
              spot(
                sessionFile,
                MCP_SESSION_NEW,
                'const transport = new StreamableHTTPClientTransport',
                "requestInit: { headers: { 'x-paywall-id'",
                'high',
                {
                  title: 'The paywall travels as a header',
                  why: 'The paywall id travels as a header; the MCP server must accept it on every request, not just initialize.',
                  explain:
                    '`requestInit` is applied to every HTTP request the streamable transport makes, so the server sees `x-paywall-id` on the initialize call and on each tool call. The same `signal` aborts the connect when the editor closes the chat.',
                }
              ),
            ],
          },
          {
            title: 'Route messages through the session',
            summary:
              'send() connects if needed and walks the parts of one chat.complete call, recording each as its own message. reset() now closes the session.',
            spots: [
              spot(
                chatFile,
                EMBEDDED_CHAT_NEW,
                'const stream = this.session.complete',
                "this.record({ id: part.id, role: 'assistant'",
                'high',
                {
                  title: 'Every part becomes a row',
                  why: 'Each streamed part becomes its own message. Long replies will arrive as many rows unless the server sends one text part.',
                  explain:
                    '`send` iterates the generator with `for await`. Tool results go through `describeTool`, text parts become assistant messages, and both pass through `record`, which appends to `history` and calls `onMessage` so the editor renders them in order.',
                }
              ),
              spot(chatFile, EMBEDDED_CHAT_NEW, 'async reset()', 'await this.session.close();', 'normal', {
                title: 'Reset closes the connection',
                why: 'reset() changed from sync to async. Two call sites in the editor await it now.',
                explain:
                  'Clearing the history alone would leave an open MCP connection per reset. `close()` shuts the SDK client and drops it, so the next `send` connects again with a fresh session.',
              }),
            ],
          },
          {
            title: 'Render tool results inline',
            summary:
              'The session splits the tool response into text and tool_result parts; the chat turns tool results into rows with role tool.',
            spots: [
              spot(
                sessionFile,
                MCP_SESSION_NEW,
                'for (const item of response.content',
                "yield { kind: 'text', id: crypto.randomUUID()",
                'high',
                {
                  title: 'Split the response into parts',
                  why: '`isError` is always false here, so a failed tool is never labelled as failed.',
                  explain:
                    '`chat.complete` returns one `content` array. Items of type `tool_result` become tool parts with their name and text; everything else is treated as text and gets a fresh id so the editor can key the rows.',
                }
              ),
              spot(chatFile, EMBEDDED_CHAT_NEW, 'private describeTool', 'toolName: result.name,', 'normal', {
                title: 'Tool rows carry the tool name',
                why: 'Failed tools are shown to the user with the raw error text.',
                explain:
                  'A tool result becomes a message with role `tool` and the tool’s name, which the transcript uses for the row label. A failed result is prefixed with the tool name and “failed:”.',
              }),
            ],
          },
          {
            title: 'Test the session',
            summary: 'Three new tests run the session against a fake MCP server.',
            spots: [
              spot(
                testFile,
                MCP_SESSION_TEST_NEW,
                "it('gives up after three failed connects'",
                "rejects.toThrow('The MCP server is unreachable.')",
                'high',
                {
                  title: 'Three refused connects, then the error',
                  why: 'Only refused connects are tested. A server that accepts and then drops, the case that matters, is not.',
                  explain:
                    'The fake server refuses every connect. Three calls fail with the transport error and the fourth fails with the unreachable message without touching the network, which is what the user sees in the chat.',
                }
              ),
            ],
          },
        ],
        judgementCalls: [
          {
            title: 'Keep the EmbeddedChat API',
            call: 'Kept the public EmbeddedChat API',
            reason: 'Only the constructor option was renamed, so the editor change stays small.',
            file: chatFile,
            ...rangeOf(EMBEDDED_CHAT_NEW, 'export interface EmbeddedChatOptions', 'signal?: AbortSignal;'),
            alternatives: [
              {
                option: 'Hand the McpSession to the editor',
                rejected:
                  'Every editor screen that embeds the chat would learn about MCP, connects and tool parts.',
              },
              {
                option: 'Add an EmbeddedChatV2 next to the old class',
                rejected:
                  'Two chats to keep in step until the old endpoint is switched off, and nothing else uses the old one.',
              },
            ],
          },
          {
            title: 'Reconnect at most three times',
            call: RECONNECT_CALL,
            reason:
              'Matches the editor’s other network retries; past that the user sees an error instead of a spinner.',
            file: sessionFile,
            ...rangeOf(MCP_SESSION_NEW, 'const RECONNECT_LIMIT = 3;', 'const RECONNECT_LIMIT = 3;'),
            alternatives: [
              {
                option: 'Exponential backoff up to a 30 second deadline',
                rejected: 'The user watches a spinner for half a minute before learning the server is down.',
              },
              {
                option: 'Keep retrying in the background',
                rejected:
                  'The chat looks alive while every message fails, and nothing tells the user to reload.',
              },
            ],
          },
          {
            title: 'chat.complete as an MCP tool',
            call: 'Called chat.complete as an MCP tool instead of using sampling',
            reason:
              'The paywall server owns the model and the paywall tools, so the chat asks it through one tool call. Sampling would run the model on our side.',
            file: sessionFile,
            ...rangeOf(
              MCP_SESSION_NEW,
              'const response = await this.client.callTool(',
              '{ signal: options.signal }'
            ),
            alternatives: [
              {
                option: 'MCP sampling with sampling/createMessage',
                rejected:
                  'Sampling is the server asking the client for a completion; here the server has the model and the tools.',
              },
            ],
          },
          {
            title: 'Keep complete() a generator',
            call: 'Kept complete() a generator although the reply arrives whole',
            reason:
              'The server sends the whole response today. When it starts sending progress notifications, only McpSession changes and send() stays as it is.',
            file: sessionFile,
            ...rangeOf(MCP_SESSION_NEW, 'async *complete(', 'async *complete('),
            alternatives: [
              {
                option: 'Return an array of parts',
                rejected: 'Simpler now, but send() would change again once the server streams.',
              },
            ],
          },
        ],
        walkthrough: {
          approach:
            'The old chat posted the whole history to `/chat` and waited for one reply. This change puts an `McpSession` between the chat and the paywall server: it owns the official SDK `Client`, connects on the first message, and turns one `chat.complete` tool call into a list of parts.\n\n`EmbeddedChat` keeps its shape. `send()` still takes text and reports messages through `onMessage`; it now walks the parts and records text and tool results as separate rows. Only the constructor option changed, from `endpoint` to `serverUrl`, and `reset()` became async because it closes the connection.\n\n`transport.ts` is deleted: the chat was its only caller.',
          flow: '1. The editor calls `send(text)`. The user message goes into `history` first.\n2. `ensureConnected` returns at once when a client exists. Otherwise it counts an attempt and connects over streamable HTTP with `x-paywall-id` on every request. After three failures in a row it throws “The MCP server is unreachable.”\n3. `complete` calls the `chat.complete` tool with the history and the paywall id.\n4. The response’s `content` items become parts: `tool_result` items as tool parts, the rest as text.\n5. `send` records each part through `record`, which appends it to `history` and hands it to `onMessage`.\n6. `reset()` clears the history and closes the client.\n\n```text\neditor\n  │ send(text)\n  ▼\nEmbeddedChat ──────────────── history.push(user message)\n  │\n  ▼\nMcpSession.ensureConnected ── first call: Client.connect,\n  │                            streamable HTTP, x-paywall-id\n  ▼\nMcpSession.complete ──callTool(chat.complete)──▶ MCP server\n  │                                                  │\n  │ ◀──────────── content[]: text, tool_result ──────┘\n  ▼\nparts ──▶ record() ──▶ history + onMessage ──▶ transcript rows\n```\n\nThe history sent to the server includes the tool rows, so the model sees what its tools returned on the next turn.',
          risks: [
            {
              title: 'Orphaned user turn on a failed connect',
              risk: 'The user message is pushed before connecting. If the connect fails or the signal aborts, the history keeps a user turn with no reply and the next send carries it along.',
              file: chatFile,
              ...rangeOf(
                EMBEDDED_CHAT_NEW,
                'this.history.push(message);',
                'await this.session.ensureConnected'
              ),
            },
            {
              title: 'Replies arrive whole',
              risk: 'Nothing streams yet: `callTool` resolves with the whole response before the first part is yielded, so a long reply still shows nothing until it is complete.',
              file: sessionFile,
              ...rangeOf(
                MCP_SESSION_NEW,
                'const response = await this.client.callTool(',
                '{ signal: options.signal }'
              ),
            },
            {
              title: 'Paywall id read on every request',
              risk: 'The paywall server has to read `x-paywall-id` on every request. If it only checks it on initialize, tool calls run against no paywall.',
              file: sessionFile,
              ...rangeOf(
                MCP_SESSION_NEW,
                "requestInit: { headers: { 'x-paywall-id'",
                "requestInit: { headers: { 'x-paywall-id'"
              ),
            },
          ],
          testing: {
            automated: [
              '`mcp-session.test.ts` runs the session against a fake MCP server: three refused connects then the unreachable error, `x-paywall-id` on every request, and tool results arriving as their own parts.',
            ],
            manual: [
              {
                action: 'Start the editor and the local MCP server from the worktree.',
                target: { kind: 'command', value: 'PAYWALL_MCP_URL=http://localhost:7410/mcp bun dev' },
                expect: 'The editor serves on port 5173 and the chat panel opens without a connection error.',
              },
              {
                action: 'Open a paywall and ask the chat to change the headline to “Spring sale”.',
                target: { kind: 'url', value: 'http://localhost:5173/paywalls/spring-sale' },
                expect:
                  'A tool row with `paywall.update` appears under the reply and the preview shows the new headline.',
              },
              {
                action: 'Stop the MCP server mid-conversation and send another message.',
                target: null,
                expect: 'After three failed tries the chat shows the unreachable error instead of a spinner.',
              },
              {
                action: 'Reset the chat while a reply is still streaming, then send a new message.',
                target: null,
                expect: 'The next conversation starts empty, with no half reply from the old one.',
              },
              {
                action: 'Check that the paywall id rides on every request, not only on initialize.',
                target: {
                  kind: 'file',
                  value: `${sessionFile}:${lineOf(MCP_SESSION_NEW, "requestInit: { headers: { 'x-paywall-id'")}`,
                },
                expect: 'The header is set on the transport, so every tool call carries `x-paywall-id`.',
              },
            ],
          },
          steps: [
            {
              when: 'pre_merge',
              kind: 'env',
              title: 'Set `PAYWALL_MCP_URL` for the editor in production',
              detail:
                'The editor builds `serverUrl` from it and has no default. Use the MCP v2 endpoint, `https://mcp.superwall.com/v2`; staging already has it. `.env.example` names it.',
              command: 'vercel env add PAYWALL_MCP_URL production',
            },
            {
              when: 'post_merge',
              kind: 'config',
              title: 'Turn on `embedded-chat-mcp-v2` for 10% of workspaces',
              detail:
                'In LaunchDarkly, production. Raise it to everyone once the chat’s error rate holds for a day.',
              command: null,
            },
          ],
        },
      },
      reviewSummary:
        'I read the new MCP session, the rewired chat and the three new tests, and ran a chat against a server that drops after connecting. The tool rows work; the reconnect limit does not hold, so a flaky server keeps the chat retrying forever, and failed tools are never labelled.',
      reviewDisagreements: [
        {
          call: RECONNECT_CALL,
          reason:
            'Three is a fine number, but it is not enforced: the counter resets after every good connect, so a server that accepts and then drops is retried forever. Count per session, and test a server that drops, not only one that refuses.',
        },
      ],
      findings: [
        {
          severity: 'blocking',
          file: sessionFile,
          line: lineOf(MCP_SESSION_NEW, 'async ensureConnected('),
          end: lineOf(MCP_SESSION_NEW, 'this.attempts = 0;'),
          title: 'The reconnect limit resets on every connect',
          message:
            'ensureConnected sets attempts back to 0 after each successful connect. A server that accepts and then drops gets three new tries every time, so the chat never shows the unreachable error the plan promises.',
          fix: 'Count attempts for the whole session: remove `this.attempts = 0;` from ensureConnected and reset it in `close()` instead.\n\n```ts\nasync close() {\n  await this.client?.close();\n  this.client = null;\n  this.attempts = 0;\n}\n```',
        },
        {
          severity: 'should_fix',
          file: sessionFile,
          line: lineOf(MCP_SESSION_NEW, 'const client = new Client({'),
          end: lineOf(MCP_SESSION_NEW, 'this.client = client;'),
          title: 'A dropped connection is never noticed',
          message:
            'this.client stays set after the transport closes, so ensureConnected returns early and the next complete() call fails on a dead client instead of reconnecting.',
          fix: 'Clear the client when the connection closes:\n\n```ts\nclient.onclose = () => {\n  this.client = null;\n};\n```',
        },
        {
          severity: 'should_fix',
          file: sessionFile,
          line: lineOf(MCP_SESSION_NEW, "if (item.type === 'tool_result')"),
          end: lineOf(MCP_SESSION_NEW, 'isError: false'),
          title: 'Failed tools are never labelled',
          message:
            'complete() sets `isError: false` on every tool result, so describeTool never takes its failed branch and a failed paywall.update reads like a success. The plan promises failures are labelled.',
          fix: 'Pass the flag through from the response item:\n\n```ts\nisError: item.isError === true,\n```\n\nand add `isError?: boolean` to the item type.',
        },
        {
          severity: 'should_fix',
          file: chatFile,
          line: lineOf(EMBEDDED_CHAT_NEW, 'async reset()'),
          end: lineOf(EMBEDDED_CHAT_NEW, 'await this.session.close();'),
          title: 'reset() clears the history before the session closes',
          message:
            'A reply still streaming when reset() runs is recorded into the new, empty history, so the next conversation starts with a stray assistant message.',
          fix: 'Close the session first, then clear the history.',
        },
      ],
      runs: [
        { role: 'agent', purpose: 'plan', minutes: 6, summary: 'Proposed the MCP session plan.' },
        { role: 'agent', purpose: 'build', minutes: 34, summary: 'Built the session and rewired the chat.' },
        {
          role: 'reviewer',
          minutes: 4,
          summary: 'One blocking finding on the reconnect limit, three suggestions.',
          reply:
            'One blocking finding: the reconnect counter in [mcp-session.ts](shinsa://file/src/chat/mcp-session.ts#L26) resets after every successful connect, so a flaky server gets three new tries every time, and I disagree with the reconnect limit decision for the same reason. Three suggestions, on dropped connections, unlabelled tool failures and reset().\n\n[Let the embedded chat call paywall tools](shinsa://task/task-chat-tools) waits on this change, and #4531 from "Refuse to duplicate code-first paywalls" touches the same editor, so merging that first keeps the conflicts small. The work is on [feat/embedded-chat-mcp](shinsa://branch/feat/embedded-chat-mcp) in [paywall-next](shinsa://repo/paywall-next).',
        },
      ],
      extra: listEmbeddedChatIterations(),
      gate: {
        type: 'review',
        title: 'Review the embedded chat on MCP v2',
        body: 'Built, checked and reviewed by an agent. One blocking finding and three suggestions left for you to judge.',
      },
    },
    {
      id: 'task-chat-tools',
      request: 'Let the embedded chat call paywall.read and paywall.update through MCP.',
      title: 'Let the embedded chat call paywall tools',
      repo: paywall,
      size: 'large',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Run the embedded chat on MCP v2” to finish',
      branch: 'feat/embedded-chat-tools',
      ageHours: 20,
      waitsOn: ['task-embedded-chat'],
    },
    {
      id: 'task-chat-paywall-editing',
      request:
        'Edit a paywall from inside the embedded chat: the chat proposes the change and shows it live.',
      title: 'Edit paywalls from the embedded chat',
      repo: paywall,
      size: 'large',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Let the embedded chat call paywall tools” to finish',
      branch: 'feat/embedded-chat-paywall-editing',
      ageHours: 18,
      waitsOn: ['task-chat-tools'],
    },
    {
      id: 'task-tool-progress',
      request: 'Show a progress line in the chat while a streamed MCP tool is still running.',
      title: 'Show tool progress in the chat',
      repo: paywall,
      size: 'small',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Stream MCP tool results” to finish',
      branch: 'feat/chat-tool-progress',
      ageHours: 0.9,
      waitsOn: ['task-stream-tools'],
    },
    {
      id: 'task-tool-retry',
      request: 'Retry a streamed MCP tool call from the chat when it fails halfway.',
      title: 'Retry failed tool calls in the chat',
      repo: paywall,
      size: 'small',
      priority: 'high',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Stream MCP tool results” to finish',
      branch: 'feat/chat-tool-retry',
      ageHours: 0.85,
      waitsOn: ['task-stream-tools'],
      extra: [
        {
          type: 'on_behalf.acted',
          command: 'task.prioritize',
          taskId: 'task-tool-retry',
          summary: 'Set the priority of “Retry failed tool calls in the chat” to high',
          byTaskId: 'task-stream-tools',
        },
      ],
    },
    {
      id: 'task-tool-summary',
      request: 'At the end of a chat, summarise which tools ran, how long they took and which were retried.',
      title: 'Summarise tool runs at the end of a chat',
      repo: paywall,
      size: 'large',
      stage: 'waiting_on_tasks',
      reason: 'waiting for “Show tool progress in the chat”, “Retry failed tool calls in the chat” to finish',
      branch: 'feat/chat-tool-summary',
      ageHours: 0.8,
      waitsOn: ['task-tool-progress', 'task-tool-retry'],
    },
  ];
}

function listEmbeddedChatIterations(): ShinsaEventInput[] {
  return listSeedIterations('task-embedded-chat', 'task-embedded-chat-run-0', [
    {
      text: 'Tool results should be collapsed by default, they push the conversation down. Also what happens if MCP v2 is down when the chat opens?',
      reply: {
        headline:
          'Tool results start folded to one line, and the chat falls back to a clear error when MCP v2 is unreachable.',
        points: [
          {
            ask: 'Collapse tool results by default',
            outcome: 'done',
            note: 'Each result is one line with its tool name and status; click it to open the full output.',
          },
          {
            ask: 'What happens if MCP v2 is down when the chat opens?',
            outcome: 'answered',
            note: '`McpSession` retries three times over 10 seconds, then the chat shows "The assistant is offline" with a Retry button. Nothing is sent to the old `/chat` endpoint.',
          },
        ],
        next: '1. Run `bun dev` in [paywall-next](shinsa://repo/paywall-next) and open the paywall editor.\n2. Ask the assistant to list products: the tool result shows as one folded line.\n3. Stop the MCP server with `bun mcp:stop` and reload: after about 10 seconds you see the offline notice.',
      },
    },
  ]);
}
