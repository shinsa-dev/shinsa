import type { Gate, GateType, Task } from '../domain/index.ts';

interface GateWords {
  label: string;
  reason: string;
  why: (gate: Gate, task: Task) => string;
}

function describePaused(gate: Gate) {
  return `Paused: ${gate.title}`;
}

const GATE_WORDS: Record<GateType, GateWords> = {
  plan: {
    label: 'Plan',
    reason: 'Needs the plan approved before building starts',
    why: () => 'The plan needs your approval before building starts',
  },
  review: {
    label: 'Review',
    reason: 'Built, checked and ready for you',
    why: () => 'Built and checked, the changes are ready for your review',
  },
  merge: {
    label: 'Merge',
    reason: 'Clean and ready to merge',
    why: (_gate, task) =>
      task.pullRequest ? 'The pull request is clean and ready to merge' : 'Clean and ready to merge',
  },
  question: {
    label: 'Question',
    reason: 'An agent is waiting on your answer',
    why: (gate) => `An agent is waiting on your answer: ${gate.title}`,
  },
  secret: {
    label: 'Secret',
    reason: 'An agent needs a secret from you',
    why: (gate) => `An agent needs a secret from you: ${gate.title}`,
  },
  proposal: {
    label: 'Proposal',
    reason: 'An agent proposes what comes next and waits for your OK',
    why: () => 'An agent proposes what comes next, and it goes on only if you agree',
  },
  operation: {
    label: 'Operation',
    reason: 'The change merged and the operation waits for your OK',
    why: () => 'The change merged, and the operation runs once you confirm it',
  },
  failure: { label: 'Paused', reason: 'Paused and needs a decision', why: describePaused },
  configuration: {
    label: 'Paused',
    reason: 'The setup needs fixing before work can start',
    why: describePaused,
  },
  sign_in: { label: 'Paused', reason: 'An agent needs you to sign in again', why: describePaused },
};

export function resolveGateWords(gate: Gate) {
  return GATE_WORDS[gate.type];
}
