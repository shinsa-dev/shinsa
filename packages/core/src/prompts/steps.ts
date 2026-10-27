import {
  COMPOSABLE_STEPS,
  listVerificationRules,
  PLAN_EVIDENCE_KINDS,
  resolveTaskPipeline,
  STEP_SCHEMA,
  type StepActor,
  type Task,
  VERIFICATION_RULES,
} from '../domain/index.ts';

function describeActor(actor: StepActor) {
  if (actor.by === 'agent') return `the ${actor.role}`;
  return actor.by === 'you' ? 'the human' : 'Shinsa';
}

export function describeStepCatalog() {
  return COMPOSABLE_STEPS.map((step) => {
    const definition = STEP_SCHEMA[step];
    return `- \`${step}\` (${describeActor(definition.actor)}): ${definition.exit}`;
  }).join('\n');
}

export function describeStepRules() {
  const needs = COMPOSABLE_STEPS.flatMap((step) => STEP_SCHEMA[step].needs.map((need) => need.rule));
  const verification = VERIFICATION_RULES.filter((rule) => rule.check.kind === 'step').map(
    (rule) => rule.message
  );
  return [...new Set([...needs, ...verification])].map((rule) => `- ${rule}`).join('\n');
}

const PLAN_PARAMETERS = {
  code: [
    '`verification` is the verification plan and is required: for each phase and the whole change, the existing tools that prove it (tests, the type check, lint, the app in a browser, a script) and anything you build to prove it.',
    `\`evidence\` names what the builders attach as evidence before the human reviews (${PLAN_EVIDENCE_KINDS.map((kind) => `\`${kind}\``).join(', ')}). A change the human sees in the UI always asks for a \`screenshot\`. Shinsa refuses the last phase until each kind is attached.`,
    "`checks` adds commands Shinsa runs with the repository's own checks (a targeted test, a build). Leave it empty when the repository's checks prove the change.",
    '`approval`: set it to true when the change is risky enough that the human should approve the plan before anything is built.',
  ],
  operation: [
    '`impact` is required: what the operation changes and how much, the result of a dry run (or why none is possible) and how to undo it.',
  ],
} as const;

export function describePlanParameters(task: Task) {
  const classes = new Set(listVerificationRules(resolveTaskPipeline(task)).map((rule) => rule.applies));
  const lines = [
    ...(classes.has('code') ? PLAN_PARAMETERS.code : []),
    ...(classes.has('operation') ? PLAN_PARAMETERS.operation : []),
  ];
  if (lines.length === 0) return '';
  return ['', 'Shinsa checks the plan against its rules and returns every problem to you:', ...lines].join(
    '\n'
  );
}
