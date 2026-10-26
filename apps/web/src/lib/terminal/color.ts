const NUMBER = String.raw`(-?[\d.]+%?)`;

const OKLCH = new RegExp(
  String.raw`^oklch\(\s*${NUMBER}\s+${NUMBER}\s+${NUMBER}(?:\s*/\s*${NUMBER})?\s*\)$`,
  'i'
);

const RGB = new RegExp(
  String.raw`^rgba?\(\s*${NUMBER}[\s,]+${NUMBER}[\s,]+${NUMBER}(?:\s*[,/]\s*${NUMBER})?\s*\)$`,
  'i'
);

const FADED = /^color-mix\(\s*in\s+[a-z]+\s*,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\s*\)$/i;

function readNumber(text: string | undefined, percentOf = 1) {
  if (text === undefined) return null;
  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return null;
  return text.endsWith('%') ? (value / 100) * percentOf : value;
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function toGamma(linear: number) {
  return linear <= 0.003_130_8 ? 12.92 * linear : 1.055 * linear ** (1 / 2.4) - 0.055;
}

function toHex(channels: number[], alpha: number) {
  const bytes = channels.map((channel) => Math.round(clamp(channel) * 255));
  if (alpha < 1) bytes.push(Math.round(clamp(alpha) * 255));
  return `#${bytes.map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export function convertOklch(lightness: number, chroma: number, hue: number) {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.396_337_777_4 * a + 0.215_803_757_3 * b) ** 3;
  const m = (lightness - 0.105_561_345_8 * a - 0.063_854_172_8 * b) ** 3;
  const s = (lightness - 0.089_484_177_5 * a - 1.291_485_548 * b) ** 3;
  return [
    4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
    -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
    -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
  ].map(toGamma);
}

function parseHex(text: string) {
  const hex = text.slice(1);
  if (!/^(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(hex)) return null;
  const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join('') : hex;
  return `#${full.toLowerCase()}`;
}

function resolveFaded(color: string, percent: string) {
  const hex = resolveCssColor(color);
  if (!hex) return null;
  const alpha = (hex.length === 9 ? Number.parseInt(hex.slice(7), 16) / 255 : 1) * (Number(percent) / 100);
  const byte = Math.round(clamp(alpha) * 255);
  return `${hex.slice(0, 7)}${byte.toString(16).padStart(2, '0')}`;
}

export function resolveCssColor(value: string): string | null {
  const text = value.trim();
  if (text.startsWith('#')) return parseHex(text);
  const faded = FADED.exec(text);
  if (faded) return resolveFaded(faded[1] ?? '', faded[2] ?? '');
  const oklch = OKLCH.exec(text);
  if (oklch) {
    const [lightness, chroma, hue] = [
      readNumber(oklch[1]) ?? 0,
      readNumber(oklch[2], 0.4) ?? 0,
      readNumber(oklch[3]) ?? 0,
    ];
    return toHex(convertOklch(lightness, chroma, hue), readNumber(oklch[4]) ?? 1);
  }
  const rgb = RGB.exec(text);
  if (!rgb) return null;
  const channels = [rgb[1], rgb[2], rgb[3]].map((channel) => (readNumber(channel, 255) ?? 0) / 255);
  return toHex(channels, readNumber(rgb[4]) ?? 1);
}
