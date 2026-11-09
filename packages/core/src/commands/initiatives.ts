export type InitiativeAgentCommand = {
  type: 'agent.report_initiative';
  runId: string;
  narrative: string;
  questions: string[];
};

export type InitiativeSystemCommand = { type: 'initiative.wake_lead'; initiativeId: string };
