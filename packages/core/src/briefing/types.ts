export interface BriefingItem {
  taskId: string;
  why: string;
}

export interface Briefing {
  now: BriefingItem | null;
  next: BriefingItem[];
  running: string;
  note: string | null;
}

export interface StoredBriefing {
  text: string;
  at: number;
  briefing: Briefing | null;
}

export const BRIEFING_LIMITS = { why: 140, note: 160, next: 3 } as const;
