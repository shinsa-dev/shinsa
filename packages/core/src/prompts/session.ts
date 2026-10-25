import type { ShinsaState } from '../state/project.ts';

export function resolveContinuePrompt() {
  return [
    'Shinsa restarted while you were working, so your process was stopped in the middle of your step and is now back up.',
    'Continue exactly where you left off and finish your step.',
    'Whatever you were doing last may not have finished: re-check the state of any file you were editing and any command you had running before you assume it completed.',
  ].join(' ');
}

export const QUESTION_WITHDRAWN = 'The question was withdrawn.';

export function resolveWithdrawnReply() {
  return `${QUESTION_WITHDRAWN} Continue with your best judgement.`;
}

const ANSWERED_BY = {
  human: 'The human answered: ',
  delegator: 'The agent that delegated this work to you answered: ',
} as const;

export function resolveAnsweredReply(text: string, delegated: boolean) {
  return `${delegated ? ANSWERED_BY.delegator : ANSWERED_BY.human}${text}`;
}

export function readAnsweredReply(reply: string) {
  const prefix = Object.values(ANSWERED_BY).find((candidate) => reply.startsWith(candidate));
  return prefix ? reply.slice(prefix.length) : reply;
}

export function resolveSupersededReply(text: string) {
  return `${QUESTION_WITHDRAWN} The human wrote this instead: ${text}`;
}

export function resolveQuestionResumePrompt(
  question: string,
  reply: { kind: 'answered' | 'superseded'; text: string }
) {
  const said = reply.kind === 'answered' ? `Their answer: ${reply.text}` : resolveSupersededReply(reply.text);
  return [`You asked the human: ${question}`, '', said, '', 'Carry on.'].join('\n');
}

export function resolveAnswerPrompt(question: string, answer: string) {
  return resolveQuestionResumePrompt(question, { kind: 'answered', text: answer });
}

const STEER_NOTICE = [
  '<system-message>',
  'The human wants to tell you something while you keep working. Acknowledge it in one short sentence, then continue your step and take it into account.',
  '</system-message>',
].join('\n');

export function resolveSteerPrompt(text: string) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return STEER_NOTICE;
  if (trimmed.startsWith('/')) return `${text}\n\n${STEER_NOTICE}`;
  return `${STEER_NOTICE}\n\n${text}`;
}

export function resolveRecoveryNudge(why: string) {
  return `\n\nYour previous attempt ended without handing over (${why}). Continue and finish with the hand-over tool.`;
}

export function resolveFreshSessionNudge(why: string) {
  return [
    '',
    '',
    `Your previous session could not go on (${why}), so this is a fresh session in the same worktree.`,
    'Run `git status` and `git diff` to see what is already done, then finish the step with the hand-over tool.',
  ].join('\n');
}

export function resolveUsageResumeNudge() {
  return [
    '',
    '',
    'Your previous turn stopped because the usage limit was reached. The limit has reset.',
    'Continue where you left off and finish the step with the hand-over tool.',
  ].join('\n');
}

export function resolveMovedNote(cwd: string) {
  return `You now work in \`${cwd}\`, not where this conversation started. Run every command and read every file there.`;
}

export function selectSessionCwd(state: ShinsaState, sessionId: string, exceptRunId: string) {
  let latest: { cwd: string; startedAt: number } | null = null;
  for (const run of Object.values(state.runs)) {
    if (run.sessionId !== sessionId || run.id === exceptRunId) continue;
    for (const attempt of run.attempts ?? []) {
      if (attempt.cwd && (!latest || attempt.startedAt >= latest.startedAt))
        latest = { cwd: attempt.cwd, startedAt: attempt.startedAt };
    }
  }
  return latest?.cwd ?? null;
}
