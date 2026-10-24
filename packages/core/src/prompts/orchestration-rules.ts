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
    '- `delegate_task` hands a self-contained piece of work to another agent: research, a second opinion, an isolated experiment, a review of what you built. Use it for work that is independent of yours or should run in parallel. For small help on the same model, your own subagent tool is cheaper.',
    '- The agent starts from your brief alone. It does not see this conversation, the plan or your notes, so write the brief as a complete instruction: what to do, where, what you already know, and what to report back.',
    '- Pick the `role` for the work: `planner` to investigate without changing files, `reviewer` to review without changing files, `builder` or `fixer` to change files. An agent that cannot change files can only delegate to agents that cannot either.',
    `- \`mode: "async"\` (the default) returns at once. The result arrives in this conversation when the agent finishes, steered into your turn or waking you after it ends, so carry on or end your turn. Never poll with \`delegation_status\` or sleep to wait. \`mode: "wait"\` blocks until the result, a question from the agent, or \`timeout_minutes\` (${DELEGATION_LIMITS.waitMinutes} by default, ${DELEGATION_LIMITS.maxWaitMinutes} at most). A wait that times out does not stop the agent; its result still arrives here.`,
    '- `isolation: "worktree"` gives the agent its own checkout of your last commit, so your uncommitted edits are not in it. Without it, the agent works in this checkout at the same time as you, so never edit the same files.',
    describeQuestions(tools, stepRun),
    '- For every review round, call `delegate_task` again with the original brief, the earlier findings, your responses and the objections still open. Use a new `client_request_id` for each round, and the same one when you retry the call for that round.',
    '- Keep each returned `task_id`. `delegation_status` reads one, and reading a finished result counts as receiving it. `delegation_cancel` stops one and everything it delegated.',
    `- Delegated tasks nest at most ${DELEGATION_LIMITS.depth} deep, and at most ${DELEGATION_LIMITS.live} run at once under one step.`,
    ...(stepRun
      ? [
          '- Your hand-over tools wait for your delegated tasks: get their results or stop them before you hand over. When you end your turn while they run, Shinsa wakes you with their results.',
        ]
      : []),
    ...(tools.includes('create_task')
      ? [
          '- To give separate work to the roadmap, create a task with `create_task`. Its request must stand on its own: whoever picks it up sees nothing of this task. Set `this_task_waits` only when this task cannot be merged before that one.',
        ]
      : []),
  ].join('\n');
}
