import type { IconName } from '@shinsa/ui/components/icon';

export type KoePill =
  | { readonly kind: 'session'; readonly clock: string; readonly attached: number }
  | {
      readonly kind: 'prompt';
      readonly stage: 'picking' | 'listening';
      readonly icon: IconName;
      readonly title: string;
      readonly detail: string;
    }
  | { readonly kind: 'notice'; readonly title: string; readonly detail: string };

export type KoeSelection = 'none' | 'drawing' | 'picked';

export interface KoeStep {
  readonly ms: number;
  readonly pill: KoePill | null;
  readonly said: string;
  readonly selection: KoeSelection;
  readonly pointer: 'none' | 'field' | 'button';
  readonly pin: boolean;
  readonly pasted: boolean;
}

const SAID_SAVE = 'The save button on the settings page does nothing.';
const SAID_GREY = 'It stays grey after I change the name.';
const SAID_BLUE = 'This should turn blue.';
const SAID_FIX = 'Can you fix both?';

const IDLE: KoeStep = {
  ms: 1600,
  pill: null,
  said: '',
  selection: 'none',
  pointer: 'none',
  pin: false,
  pasted: false,
};

const SCREENSHOT_DETAIL = 'Northwind · Settings';

export const KOE_STEPS: readonly KoeStep[] = [
  IDLE,
  { ...IDLE, ms: 2400, pill: { kind: 'session', clock: '0:03', attached: 0 }, said: SAID_SAVE },
  {
    ...IDLE,
    ms: 1700,
    pill: {
      kind: 'prompt',
      stage: 'picking',
      icon: 'IconScreenCapture',
      title: 'Drag over a region, or click a window',
      detail: SCREENSHOT_DETAIL,
    },
    selection: 'drawing',
    pointer: 'field',
  },
  {
    ...IDLE,
    ms: 2400,
    pill: {
      kind: 'prompt',
      stage: 'listening',
      icon: 'IconScreenCapture',
      title: 'Talk about it, or just attach',
      detail: SCREENSHOT_DETAIL,
    },
    said: SAID_GREY,
    selection: 'picked',
    pointer: 'field',
  },
  { ...IDLE, ms: 900, pill: { kind: 'session', clock: '0:08', attached: 1 } },
  {
    ...IDLE,
    ms: 1500,
    pill: {
      kind: 'prompt',
      stage: 'picking',
      icon: 'IconBubbleAnnotation2',
      title: 'Click anything to comment on it',
      detail: 'Save',
    },
    pointer: 'button',
  },
  {
    ...IDLE,
    ms: 2200,
    pill: {
      kind: 'prompt',
      stage: 'listening',
      icon: 'IconBubbleAnnotation2',
      title: 'Say comment 1',
      detail: 'Save',
    },
    said: SAID_BLUE,
    pointer: 'button',
    pin: true,
  },
  { ...IDLE, ms: 1900, pill: { kind: 'session', clock: '0:13', attached: 2 }, said: SAID_FIX, pin: true },
  {
    ...IDLE,
    ms: 2200,
    pill: {
      kind: 'notice',
      title: 'Copied to clipboard',
      detail: 'Press ⌘V to paste your words and 2 attachments anywhere',
    },
  },
  { ...IDLE, ms: 5200, pasted: true },
];

export const KOE_BUNDLE = [
  { text: SAID_SAVE },
  { marker: '1', note: SAID_GREY },
  { marker: '2', note: SAID_BLUE },
  { text: SAID_FIX },
] as const;

const WAVE_HEIGHTS = [
  0.35, 0.6, 0.45, 0.8, 0.55, 0.95, 0.5, 0.7, 0.4, 0.85, 0.6, 0.3, 0.75, 0.5, 0.9, 0.45, 0.65, 0.35, 0.7, 0.5,
  0.4, 0.6,
];

export const KOE_WAVE_BARS = WAVE_HEIGHTS.map((height, index) => ({ id: `bar-${index}`, height, index }));
