import { quoteTitle } from '../chat/text.ts';
import { INITIATIVE_LIMITS, type Initiative, selectInitiativePhase, type Task } from '../domain/index.ts';

export interface LeadTurn {
  initiative: Initiative;
  digest: string;
  milestones: string;
  note: string | null;
  first: boolean;
}

const LEAD_RULES = [
  'You lead this initiative: a group of tasks across repositories that ships piece by piece. You do no repository work and open no pull request yourself.',
  '- File the next pieces with `create_task`: they join the initiative by themselves. Order them with `tasks_wait_on`, set their phase with `tasks_join_initiative`, and change priorities with `tasks_prioritize`.',
  '- Read a member with `read_task` only when you need more than the overview below. Tell a member something with `tasks_message`.',
  '- Plans, reviews and merges stay the human’s. Never ask a member to skip a gate.',
  '- Members may message you when their scope changes; keep the order of the work in line with it.',
];

function describeOpening(turn: LeadTurn) {
  const name = quoteTitle(turn.initiative.name);
  if (turn.note) return `The human wrote to you about the initiative ${name}.`;
  if (turn.first) return `Shinsa started you to lead the initiative ${name}.`;
  return `Shinsa woke you because members of the initiative ${name} moved on.`;
}

function describePhases(initiative: Initiative) {
  if (initiative.phases.length === 0) return 'It has no phases yet.';
  return `Its phases, in order: ${initiative.phases.map((phase) => phase.name).join(', ')}.`;
}

export function resolveLeadPrompt(turn: LeadTurn) {
  const description = turn.initiative.description ? [turn.initiative.description, ''] : [];
  return [
    describeOpening(turn),
    '',
    ...LEAD_RULES,
    '',
    ...description,
    describePhases(turn.initiative),
    '',
    'Where it stands:',
    turn.digest,
    ...(turn.milestones ? ['', 'What happened since your last turn:', turn.milestones] : []),
    ...(turn.note ? ['', `The human wrote: ${turn.note}`] : []),
    '',
    `When you are done, call \`report_initiative\` with a \`narrative\` of where the initiative stands and what comes next (at most ${INITIATIVE_LIMITS.narrative} characters) and up to ${INITIATIVE_LIMITS.questions} \`questions\` only the human can settle. The human reads both at the top of the initiative's page. Then stop.`,
  ].join('\n');
}

export function describeInitiativeMembership(initiative: Initiative, task: Task, lead: Task | null) {
  const phase = selectInitiativePhase(initiative, task.initiativePhaseId);
  const where = phase ? `, in its phase ${quoteTitle(phase.name)}` : '';
  const opening = `This task is part of the initiative ${quoteTitle(initiative.name)}${where}.`;
  if (!lead) return `\n\n${opening}`;
  return `\n\n${opening} Its lead is [${lead.title}](shinsa://task/${lead.id}): tell it with \`tasks_message\` when your scope changes or another task of the initiative should wait for yours.`;
}
