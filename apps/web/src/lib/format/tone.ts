export type Tone = 'neutral' | 'blue' | 'amber' | 'orange' | 'green' | 'red' | 'purple';

export const TONE_SURFACE: Record<Tone, string> = {
  neutral: 'bg-bg-a2 text-fg-3',
  blue: 'bg-primary-a2 text-primary-text',
  amber: 'bg-amber-a2 text-amber-text',
  orange: 'bg-orange-a2 text-orange-text',
  green: 'bg-green-a2 text-green-text',
  red: 'bg-red-a2 text-red-text',
  purple: 'bg-purple-a2 text-purple-text',
};

export const TONE_SURFACE_HOVER: Record<Tone, string> = {
  neutral: 'hover:bg-bg-a3 active:bg-bg-a3',
  blue: 'hover:bg-primary-a3 active:bg-primary-a3',
  amber: 'hover:bg-amber-a3 active:bg-amber-a3',
  orange: 'hover:bg-orange-a3 active:bg-orange-a3',
  green: 'hover:bg-green-a3 active:bg-green-a3',
  red: 'hover:bg-red-a3 active:bg-red-a3',
  purple: 'hover:bg-purple-a3 active:bg-purple-a3',
};

export const TONE_WASH: Record<Tone, string> = {
  neutral: 'bg-bg-a1',
  blue: 'bg-primary-a2',
  amber: 'bg-amber-a2',
  orange: 'bg-orange-a2',
  green: 'bg-green-a2',
  red: 'bg-red-a2',
  purple: 'bg-purple-a2',
};

export const TONE_EDGE: Record<Tone, string> = {
  neutral: 'border-border',
  blue: 'border-primary-a3',
  amber: 'border-amber-a3',
  orange: 'border-orange-a3',
  green: 'border-green-a3',
  red: 'border-red-a3',
  purple: 'border-purple-a3',
};

export const TONE_TEXT: Record<Tone, string> = {
  neutral: 'text-fg-2',
  blue: 'text-primary-text',
  amber: 'text-amber-text',
  orange: 'text-orange-text',
  green: 'text-green-text',
  red: 'text-red-text',
  purple: 'text-purple-text',
};

export const TONE_FILL: Record<Tone, string> = {
  neutral: 'bg-fg-2',
  blue: 'bg-primary-4',
  amber: 'bg-amber-4',
  orange: 'bg-orange-4',
  green: 'bg-green-4',
  red: 'bg-red-4',
  purple: 'bg-purple-4',
};
