export const AUTOPILOT_CONTEXT_SECTIONS = [
  'review',
  'changes',
  'walkthrough',
  'messages',
  'replies',
  'area',
] as const;

export type AutopilotContextSectionName = (typeof AUTOPILOT_CONTEXT_SECTIONS)[number];

export interface AutopilotContextSection {
  name: AutopilotContextSectionName;
  title: string;
  lines: string[];
  omitted?: number;
}

export interface AutopilotReply {
  at: number;
  text: string;
}

export const AUTOPILOT_CONTEXT_LIMITS = {
  budget: 6000,
  sections: {
    review: 1500,
    changes: 1200,
    walkthrough: 1200,
    messages: 1000,
    replies: 1200,
    area: 900,
  } satisfies Record<AutopilotContextSectionName, number>,
  line: 300,
  files: 20,
  findings: 8,
  risks: 4,
  messages: 4,
  replies: 3,
  areaTasks: 3,
  areaAnswers: 4,
  areaDepth: 2,
} as const;

export const AUTOPILOT_CONTEXT_NAMES: Record<AutopilotContextSectionName, string> = {
  review: 'the review',
  changes: 'what changed',
  walkthrough: 'the walkthrough',
  messages: 'your messages',
  replies: 'the agent’s replies',
  area: 'your earlier tasks in this part of the app',
};
