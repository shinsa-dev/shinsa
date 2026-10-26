type Paint = (text: string) => string;

export interface Symbols {
  dot: string;
  check: string;
  cross: string;
  warning: string;
  arrow: string;
  ellipsis: string;
  spinner: readonly string[];
}

export interface Style {
  color: boolean;
  symbols: Symbols | null;
  bold: Paint;
  dim: Paint;
  accent: Paint;
  success: Paint;
  warning: Paint;
  danger: Paint;
  info: Paint;
}

export type Tone = 'bold' | 'dim' | 'accent' | 'success' | 'warning' | 'danger' | 'info';

export const UNICODE_SYMBOLS: Symbols = {
  dot: '●',
  check: '✔',
  cross: '✖',
  warning: '▲',
  arrow: '→',
  ellipsis: '…',
  spinner: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'],
};

export const ASCII_SYMBOLS: Symbols = {
  dot: '*',
  check: 'v',
  cross: 'x',
  warning: '!',
  arrow: '->',
  ellipsis: '...',
  spinner: ['|', '/', '-', '\\'],
};

interface StyleOptions {
  color: boolean;
  symbols: Symbols | null;
}

function createPaint(enabled: boolean, open: number, close: number): Paint {
  if (!enabled) return (text) => text;
  return (text) => (text ? `\u001b[${open}m${text}\u001b[${close}m` : text);
}

export function createStyle({ color, symbols }: StyleOptions): Style {
  return {
    color,
    symbols,
    bold: createPaint(color, 1, 22),
    dim: createPaint(color, 2, 22),
    accent: createPaint(color, 36, 39),
    success: createPaint(color, 32, 39),
    warning: createPaint(color, 33, 39),
    danger: createPaint(color, 31, 39),
    info: createPaint(color, 34, 39),
  };
}

export const PLAIN_STYLE = createStyle({ color: false, symbols: null });

type Env = Record<string, string | undefined>;

function isForced(env: Env) {
  const force = env.FORCE_COLOR;
  return force !== undefined && force !== '0' && force !== 'false';
}

function isColorWanted(env: Env, isTTY: boolean) {
  if (env.FORCE_COLOR !== undefined) return isForced(env);
  if (env.NO_COLOR) return false;
  if (env.TERM === 'dumb') return false;
  return isTTY;
}

function resolveSymbols(env: Env, isTTY: boolean) {
  if (env.TERM === 'dumb' || !(isTTY || isForced(env))) return null;
  return env.TERM === 'linux' ? ASCII_SYMBOLS : UNICODE_SYMBOLS;
}

export function resolveStyle(env: Env, isTTY: boolean) {
  return createStyle({ color: isColorWanted(env, isTTY), symbols: resolveSymbols(env, isTTY) });
}

export function paintTone(style: Style, tone: Tone, text: string) {
  return style[tone](text);
}

export function describeMark(style: Style, tone: Tone, symbol: keyof Omit<Symbols, 'spinner'>, text: string) {
  if (!style.symbols) return text;
  return `${paintTone(style, tone, style.symbols[symbol])} ${text}`;
}

const CODE_SPAN = /`([^`]+)`/g;

export function describeInline(style: Style, text: string) {
  if (!style.color) return text;
  return text.replace(CODE_SPAN, (_span, code: string) => style.accent(code));
}
