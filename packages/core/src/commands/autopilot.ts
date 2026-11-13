import type { AutopilotSuggestionVerdict, AutopilotVerdict } from '../autopilot/schema.ts';

export type AutopilotSystemCommand =
  | {
      type: 'autopilot.fire';
      taskId: string;
      gateId: string;
      dueAt: number;
    }
  | {
      type: 'autopilot.judgment';
      taskId: string;
      gateId: string;
      verdict: AutopilotVerdict;
      reason: string;
      reply: string | null;
      shadow: boolean;
    }
  | {
      type: 'autopilot.weighed';
      taskId: string;
      suggestionId: string;
      verdict: AutopilotSuggestionVerdict;
      reason: string;
    };
