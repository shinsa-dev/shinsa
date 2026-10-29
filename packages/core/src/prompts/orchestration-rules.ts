import { DELEGATION_LIMITS, isHandOverTool, type ShinsaToolName } from '../domain/index.ts';

function describeQuestions(tools: readonly ShinsaToolName[], stepRun: boolean) {
  const base =
    '- Questions from a delegated agent come to you, not to the human. Answer them with `delegation_answer`.';
  if (!tools.includes('ask')) return base;
  if (stepRun) return `${base} When only the human can decide, ask them with \`ask\` first, then answer.`;
  return `${base} When you cannot decide, ask the agent that delegated to you with \`ask\` first, then answer.`;
}

export function resolveOrchestrationRules(tools: readonly ShinsaToolName[]) {
  const stepRun = tools.some(isHandOverTool);
  return [
    'Delegating work:',
    '- `delegate_task` is only for work whose context should stay apart from yours, such as a review or a test of what you built that your reasoning would bias, or work that is truly independent and can run in parallel. Do everything else yourself: never hand each phase, or each problem type, to its own agent, because the agent you delegate to loses this conversation. For small help on the same model, your own subagent tool is cheaper. The tool says how to brief it, wait for it and isolate it.',
    describeQuestions(tools, stepRun),
    `- Delegations nest at most ${DELEGATION_LIMITS.depth} deep.`,
    ...(stepRun
      ? [
          '- Your hand-over tools wait for your delegations: get their results or stop them before you hand over. When you stop while they run, Shinsa wakes you with their results.',
        ]
      : []),
  ].join('\n');
}
