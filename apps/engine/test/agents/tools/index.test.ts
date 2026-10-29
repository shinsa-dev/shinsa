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
      'remove_evidence',
      'find_tasks',
      'note',
      'suggest_tasks',
      'list_services',
      'run_service',
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

  test('a comparison names its parts by stage or by a short label, a theme among them', () => {
    const parts = TOOL_SPECS.attach_evidence.inputSchema.properties.parts;
    expect(parts.description).toContain('(before, after) or a short label (Empty, Loading, Light, Dark)');
    expect(parts.items.properties.label.maxLength).toBe(PROTOCOL_LIMITS.evidenceLabel);
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
    expect(review.disagreements.maxItems).toBe(PROTOCOL_LIMITS.disagreements);
    expect(review.disagreements.items.properties.reason.maxLength).toBe(PROTOCOL_LIMITS.disagreement);
    const phase = TOOL_SPECS.complete_phase.inputSchema.properties;
    expect(phase.spots.items.properties.explain.maxLength).toBe(PROTOCOL_LIMITS.explain);
    expect(phase.judgement_calls.items.properties.alternatives.maxItems).toBe(PROTOCOL_LIMITS.alternatives);
    expect(phase.walkthrough.properties.flow.maxLength).toBe(PROTOCOL_LIMITS.flow);
    expect(phase.walkthrough.properties.risks.items.properties.risk.maxLength).toBe(PROTOCOL_LIMITS.risk);
    const risk = phase.walkthrough.properties.risks.items;
    expect(risk.properties.title.maxLength).toBe(PROTOCOL_LIMITS.riskTitle);
    expect(risk.properties.title.description).toStartWith('A few words naming the risk.');
    expect(risk.required).toEqual(['title', 'risk']);
    const testing = phase.walkthrough.properties.testing.properties;
    expect(testing.automated.maxItems).toBe(PROTOCOL_LIMITS.testingAutomated);
    expect(testing.automated.items.maxLength).toBe(PROTOCOL_LIMITS.testingAutomatedItem);
    expect(testing.manual.maxItems).toBe(PROTOCOL_LIMITS.testingSteps);
    const manual = testing.manual.items.properties;
    expect(manual.action.maxLength).toBe(PROTOCOL_LIMITS.testingAction);
    expect(manual.expect.maxLength).toBe(PROTOCOL_LIMITS.testingExpect);
    expect(manual.target.properties.kind.enum).toEqual(['url', 'file', 'command', 'screen']);
    expect(manual.target.properties.value.maxLength).toBe(PROTOCOL_LIMITS.testingTarget);
    expect(testing.manual.items.required).toEqual(['action', 'expect']);
    const steps = phase.walkthrough.properties.steps;
    expect(steps.maxItems).toBe(PROTOCOL_LIMITS.mergeSteps);
    expect(steps.items.properties.when.enum).toEqual(['pre_merge', 'post_merge']);
    expect(steps.items.properties.title.maxLength).toBe(PROTOCOL_LIMITS.mergeStepTitle);
    expect(steps.items.properties.command.maxLength).toBe(PROTOCOL_LIMITS.mergeStepCommand);
    const fixWalkthrough = TOOL_SPECS.complete_fix.inputSchema.properties.walkthrough;
    expect(fixWalkthrough.properties).toBe(phase.walkthrough.properties);
    expect('required' in fixWalkthrough).toBe(false);
    expect(TOOL_SPECS.complete_fix.inputSchema.required).toEqual(['summary']);
    const call = TOOL_SPECS.complete_phase.inputSchema.properties.judgement_calls.items.properties;
    expect(call.file.maxLength).toBe(PROTOCOL_LIMITS.path);
    expect(call.call.maxLength).toBe(PROTOCOL_LIMITS.call);
    expect(call.title.maxLength).toBe(PROTOCOL_LIMITS.callTitle);
    expect(call.title.description).toStartWith('A few words naming the decision.');
    expect(TOOL_SPECS.complete_phase.inputSchema.properties.judgement_calls.items.required).toEqual([
      'title',
      'call',
      'reason',
    ]);
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

  test('evidence names each kind once and is only for a code change; the plan has no extra checks field', () => {
    expect(plan.evidence).toMatchObject({
      type: 'array',
      uniqueItems: true,
      maxItems: PLAN_EVIDENCE_KINDS.length,
      items: { type: 'string', enum: [...PLAN_EVIDENCE_KINDS] },
    });
    expect(plan.evidence.description).toContain('Only for a task that changes code');
    expect('checks' in plan).toBe(false);
    expect(plan.approval.type).toBe('boolean');
    expect(TOOL_SPECS.propose_plan.inputSchema.required).not.toContain('impact');
  });

  test('each check in the plan is a label, a scoped command and its phases, within the protocol limits', () => {
    expect(plan.verification).toMatchObject({ type: 'array', maxItems: PROTOCOL_LIMITS.checks });
    expect(plan.verification.description).toContain(requirement('code.checks'));
    expect(plan.verification.description).toContain('Never the whole suite');
    const check = plan.verification.items;
    expect(check.required).toEqual(['label', 'command', 'phases']);
    expect(check.properties.label.maxLength).toBe(PROTOCOL_LIMITS.checkLabel);
    expect(check.properties.command.maxLength).toBe(PROTOCOL_LIMITS.checkCommand);
    expect(check.properties.command.description).toContain('scoped to what the change touches');
    expect(check.properties.phases).toMatchObject({ minItems: 1, maxItems: PROTOCOL_LIMITS.planPhases });
  });

  test('a phase and a fix can change the checks, a fix can name more to run, and evidence links a check', () => {
    const phase = TOOL_SPECS.complete_phase.inputSchema.properties;
    const fix = TOOL_SPECS.complete_fix.inputSchema.properties;
    expect(phase.check_changes).toBe(fix.check_changes);
    expect(phase.check_changes).toMatchObject({ maxItems: PROTOCOL_LIMITS.checkChanges });
    expect(phase.check_changes.items.properties.action.enum).toEqual(['add', 'change', 'remove']);
    expect(phase.check_changes.items.properties.reason.maxLength).toBe(PROTOCOL_LIMITS.checkReason);
    expect(phase.check_changes.items.required).toEqual(['action', 'reason']);
    expect(fix.checks).toMatchObject({
      maxItems: PROTOCOL_LIMITS.checks,
      items: { maxLength: PROTOCOL_LIMITS.checkId },
    });
    const evidence = TOOL_SPECS.attach_evidence.inputSchema;
    expect(evidence.properties.check.maxLength).toBe(PROTOCOL_LIMITS.checkId);
    expect(evidence.required).toEqual(['kind']);
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
