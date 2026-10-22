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
