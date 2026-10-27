import { describe, expect, test } from 'bun:test';
import {
  isHandOverTool,
  PLAN_EVIDENCE_KINDS,
  PROTOCOL_LIMITS,
  type RunRole,
  SHINSA_TOOL_NAMES,
  VERIFICATION_RULES,
} from '@shinsa/core';
import { createShinsaTools, createToolSet, type ToolHandler } from '../../../src/agents/tools/index.ts';
import { TOOL_SPECS } from '../../../src/agents/tools/specs.ts';

type Handler = (request: unknown, extra: unknown) => Promise<unknown>;

function readHandlers(role: RunRole, handler: ToolHandler) {
  const tools = createShinsaTools(role, handler);
  const handlers = (tools.server as unknown as { _requestHandlers: Map<string, Handler> })._requestHandlers;
  const list = handlers.get('tools/list');
  const call = handlers.get('tools/call');
  if (!list || !call) throw new Error('handlers missing');
  return { tools, list, call };
}

const extra = { signal: new AbortController().signal };

describe('the shinsa tool server', () => {
  test('lists only the tools of the role, always loaded', async () => {
    const { tools, list } = readHandlers('reviewer', () => Promise.resolve(''));
    expect(tools).toMatchObject({ name: 'shinsa', role: 'reviewer' });
    const result = (await list({ method: 'tools/list' }, extra)) as {
      tools: { name: string; _meta: unknown }[];
    };
    expect(result.tools.map((tool) => tool.name)).toEqual([
      'report_review',
      'attach_evidence',
      'find_tasks',
      'note',
      'suggest_tasks',
      'read_task',
      'list_repository_work',
      'delegate_task',
      'delegation_status',
      'delegation_cancel',
      'delegation_answer',
      'create_task',
      'set_schedule',
      'list_schedules',
      'delete_schedule',
    ]);
    expect(result.tools[0]?._meta).toEqual({ 'anthropic/alwaysLoad': true });
  });

  test('serves a spec for every Shinsa tool and no other', () => {
    expect(Object.keys(TOOL_SPECS).sort()).toEqual([...SHINSA_TOOL_NAMES].sort());
    for (const [name, spec] of Object.entries(TOOL_SPECS)) expect(spec.name).toBe(name);
  });

  test('every hand-over tool tells the agent to stop after it, never to end its turn out loud', () => {
    const handOvers = SHINSA_TOOL_NAMES.filter(isHandOverTool).map((name) => TOOL_SPECS[name]);
    expect(handOvers.length).toBeGreaterThan(0);
    for (const spec of handOvers) {
      expect(spec.description).toMatch(/stop/);
      expect(spec.description).not.toContain('end your turn');
    }
  });

  test('a call reaches the handler, errors come back as tool errors, and other roles’ tools are refused', async () => {
    const seen: unknown[] = [];
    const { call } = readHandlers('agent', (name, input, _signal, requestId) => {
      seen.push([name, input, requestId]);
      if (name === 'note') return Promise.reject(new Error('note is required.'));
      return Promise.resolve('Handed over.');
    });
    const request = (name: string, args?: Record<string, unknown>) => ({
      method: 'tools/call',
      params: { name, arguments: args },
    });
    expect(await call(request('propose_plan', { goal: 'x' }), { ...extra, requestId: 4 })).toEqual({
      content: [{ type: 'text', text: 'Handed over.' }],
    });
    expect(await call(request('note'), extra)).toEqual({
      content: [{ type: 'text', text: 'note is required.' }],
      isError: true,
    });
    expect(await call(request('report_review'), extra)).toEqual({
      content: [{ type: 'text', text: 'report_review is not available to the agent.' }],
      isError: true,
    });
    expect(seen).toEqual([
      ['propose_plan', { goal: 'x' }, 4],
      ['note', {}, undefined],
    ]);
  });

  test('every tool a role can call has a published schema', () => {
    for (const spec of Object.values(TOOL_SPECS)) expect(spec.inputSchema.type).toBe('object');
  });

  test('the schemas publish the limits Shinsa enforces on questions and file paths', () => {
    const ask = TOOL_SPECS.ask.inputSchema.properties;
    expect(ask.question.maxLength).toBe(PROTOCOL_LIMITS.question);
    expect(ask.context.maxLength).toBe(PROTOCOL_LIMITS.questionContext);
    const review = TOOL_SPECS.report_review.inputSchema.properties;
    expect(review.summary.maxLength).toBe(PROTOCOL_LIMITS.reviewSummary);
    const finding = review.findings.items.properties;
    expect(finding.file.maxLength).toBe(PROTOCOL_LIMITS.path);
    expect(finding.title.maxLength).toBe(PROTOCOL_LIMITS.findingTitle);
    expect(finding.message.maxLength).toBe(PROTOCOL_LIMITS.finding);
    expect(finding.fix.maxLength).toBe(PROTOCOL_LIMITS.findingFix);
    const call = TOOL_SPECS.complete_phase.inputSchema.properties.judgement_calls.items.properties;
    expect(call.file.maxLength).toBe(PROTOCOL_LIMITS.path);
    expect(call.call.maxLength).toBe(PROTOCOL_LIMITS.call);
    expect(TOOL_SPECS.complete_phase.inputSchema.properties.spots.items.properties.file.maxLength).toBe(
      PROTOCOL_LIMITS.path
    );
    expect(TOOL_SPECS.propose_plan.inputSchema.properties.files.items.properties.path.maxLength).toBe(
      PROTOCOL_LIMITS.path
    );
  });
});

describe('the plan parameters propose_plan publishes', () => {
  const plan = TOOL_SPECS.propose_plan.inputSchema.properties;
  const requirement = (id: string) => VERIFICATION_RULES.find((rule) => rule.id === id)?.requirement ?? '-';

  test('the verification plan and the impact say when they are required, in the words of the rules', () => {
    expect(plan.verification.description).toContain('required for any task that changes code');
    expect(plan.verification.description).toContain(requirement('code.verification_plan'));
    expect(plan.impact).toMatchObject({ type: 'string', maxLength: PROTOCOL_LIMITS.impact });
    expect(plan.impact.description).toContain('Required for any task that runs an operation');
    expect(plan.impact.description).toContain(requirement('operation.impact'));
  });

  test('evidence names each kind once, checks are capped, and both are only for a code change', () => {
    expect(plan.evidence).toMatchObject({
      type: 'array',
      uniqueItems: true,
      maxItems: PLAN_EVIDENCE_KINDS.length,
      items: { type: 'string', enum: [...PLAN_EVIDENCE_KINDS] },
    });
    expect(plan.checks).toMatchObject({
      maxItems: PROTOCOL_LIMITS.planChecks,
      items: { type: 'string', maxLength: PROTOCOL_LIMITS.checkCommand },
    });
    expect(plan.checks.description).toContain(requirement('code.checks'));
    for (const field of [plan.evidence, plan.checks]) {
      expect(field.description).toContain('Only for a task that changes code');
    }
    expect(plan.approval.type).toBe('boolean');
    expect(TOOL_SPECS.propose_plan.inputSchema.required).not.toContain('impact');
  });
});

describe('a tool set of any specs', () => {
  test('publishes each spec with its annotations and scopes request ids to the server it serves', async () => {
    const seen: unknown[] = [];
    const tools = createToolSet(
      'planner',
      [
        {
          name: 'tasks_list',
          description: 'List tasks.',
          inputSchema: { type: 'object', properties: {} },
          annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        },
      ],
      (name, _input, _signal, requestId) => {
        seen.push([name, requestId]);
        return Promise.resolve('No tasks.');
      }
    );
    const server = tools.createServer({ scope: () => 'run-1' });
    const handlers = (server as unknown as { _requestHandlers: Map<string, Handler> })._requestHandlers;
    const listed = (await handlers.get('tools/list')?.({ method: 'tools/list' }, extra)) as {
      tools: Record<string, unknown>[];
    };
    expect(listed.tools).toEqual([
      {
        name: 'tasks_list',
        description: 'List tasks.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
        _meta: { 'anthropic/alwaysLoad': true },
      },
    ]);
    const call = handlers.get('tools/call');
    expect(
      await call?.({ method: 'tools/call', params: { name: 'tasks_list' } }, { ...extra, requestId: 7 })
    ).toEqual({
      content: [{ type: 'text', text: 'No tasks.' }],
    });
    expect(seen).toEqual([['tasks_list', 'run-1.7']]);
  });
});
