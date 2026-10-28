import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const WIDTH = 660;

const HEIGHT = 432;

const TITLE_BAR = 32;

const ICON = { y: 196, appX: 180, applicationsX: 480, appHalf: 45, applicationsHalf: 52, clearance: 14 };

const GUIDE = {
  start: ICON.appX + ICON.appHalf + ICON.clearance + 6,
  end: ICON.applicationsX - ICON.applicationsHalf - ICON.clearance - 6,
};

const DOT = { pitch: 24, radius: 1.1 };

const INK = {
  page: '#ffffff',
  dot: '#d9d9de',
  trace: '#d4d4d8',
  strong: '#18181b',
  muted: '#71717a',
  accent: '#0a7aff',
};

const WORDMARK = { size: 20, width: 62.72, mark: 20, gap: 9, y: 58 };

const PILL = { size: 11, padX: 7, height: 19, gap: 9 };

const PILLS = {
  beta: { label: 'Beta', width: 23.73, tile: '#e0edff', ink: '#0a6cdc' },
  canary: { label: 'Canary', width: 36.51, tile: '#fdf0d2', ink: '#9a5b00' },
};

const HINT = { size: 13, y: 330 };

const desktopDir = resolve(import.meta.dirname, '..');

const outDir = join(desktopDir, 'resources', 'dmg');

const fontsDir = resolve(desktopDir, '../marketing/src/assets/fonts');

const logoPath = resolve(desktopDir, '../../packages/ui/src/components/logo.tsx');

type Channel = 'stable' | 'beta' | 'canary';

const CHANNELS: Channel[] = ['stable', 'beta', 'canary'];

function listMarkPaths() {
  const source = readFileSync(logoPath, 'utf8');
  const paths = [...source.matchAll(/<path d='([^']+)'/g)].map((match) => match[1] ?? '');
  if (paths.length === 0) throw new Error(`No mark paths found in ${logoPath}.`);
  return paths;
}

function serializeDots() {
  const dots: string[] = [];
  for (let y = DOT.pitch / 2; y < HEIGHT - TITLE_BAR; y += DOT.pitch) {
    for (let x = DOT.pitch / 2; x < WIDTH; x += DOT.pitch) {
      dots.push(`<circle cx="${x}" cy="${y}" r="${DOT.radius}"/>`);
    }
  }
  return `<g fill="${INK.dot}" mask="url(#fade)">${dots.join('')}</g>`;
}

function serializeEdgeTraces() {
  const appEdge = ICON.appX - ICON.appHalf - ICON.clearance;
  const applicationsEdge = ICON.applicationsX + ICON.applicationsHalf + ICON.clearance;
  const left = [
    `M 0 ${ICON.y - 74} H 44 L 56 ${ICON.y - 62} V ${ICON.y - 18} L 68 ${ICON.y - 6} H ${appEdge}`,
    `M 0 ${ICON.y - 58} H 28 L 40 ${ICON.y - 46} V ${ICON.y - 2} L 52 ${ICON.y + 10} H ${appEdge}`,
  ];
  const right = [
    `M ${WIDTH} ${ICON.y + 82} H ${WIDTH - 44} L ${WIDTH - 56} ${ICON.y + 70} V ${ICON.y + 18} L ${WIDTH - 68} ${ICON.y + 6} H ${applicationsEdge}`,
    `M ${WIDTH} ${ICON.y + 66} H ${WIDTH - 28} L ${WIDTH - 40} ${ICON.y + 54} V ${ICON.y + 2} L ${WIDTH - 52} ${ICON.y - 10} H ${applicationsEdge}`,
  ];
  const traces = [...left, ...right]
    .map((d) => `<path d="${d}" fill="none" stroke="${INK.trace}" stroke-width="1.25"/>`)
    .join('');
  const pins = [
    [appEdge - 6, ICON.y - 6],
    [appEdge - 6, ICON.y + 10],
    [applicationsEdge, ICON.y + 6],
    [applicationsEdge, ICON.y - 10],
  ]
    .map(([x, y]) => `<rect x="${x}" y="${(y ?? 0) - 1.5}" width="6" height="3" rx="1" fill="${INK.trace}"/>`)
    .join('');
  const vias = [
    [40, 360],
    [612, 64],
    [628, 352],
  ]
    .map(
      ([x, y]) =>
        `<circle cx="${x}" cy="${y}" r="3" fill="${INK.page}" stroke="${INK.trace}" stroke-width="1.25"/>`
    )
    .join('');
  return `${traces}${pins}${vias}`;
}

function serializeGuide() {
  const { start, end } = GUIDE;
  const upper = ICON.y - 6;
  const lower = ICON.y + 6;
  const lanes = [upper, lower]
    .map((y) => `<path d="M ${start} ${y} H ${end}" fill="none" stroke="${INK.trace}" stroke-width="1.25"/>`)
    .join('');
  const pins = [start - 6, end]
    .flatMap((x) => [upper, lower].map((y) => `<rect x="${x}" y="${y - 1.5}" width="6" height="3" rx="1"/>`))
    .join('');
  const signal = `<path d="M ${start + 24} ${upper} H ${end - 2}" fill="none" stroke="url(#signal)" stroke-width="1.5" stroke-linecap="round"/>`;
  const tip = `<path d="M ${end - 9} ${upper - 5} L ${end - 3} ${upper} L ${end - 9} ${upper + 5}" fill="none" stroke="${INK.accent}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  return `${lanes}<g fill="${INK.trace}">${pins}</g>${signal}${tip}`;
}

function serializeWordmark(channel: Channel) {
  const pill = channel === 'stable' ? null : PILLS[channel];
  const badge = pill ? PILL.gap + pill.width + PILL.padX * 2 : 0;
  const total = WORDMARK.mark + WORDMARK.gap + WORDMARK.width + badge;
  const left = (WIDTH - total) / 2;
  const scale = WORDMARK.mark / 365;
  const markY = WORDMARK.y - WORDMARK.mark / 2;
  const marks = listMarkPaths()
    .map((d) => `<path d="${d}"/>`)
    .join('');
  const textX = left + WORDMARK.mark + WORDMARK.gap;
  const baseline = WORDMARK.y + WORDMARK.size * 0.358;
  const mark = `<g transform="translate(${left} ${markY}) scale(${scale.toFixed(6)})" fill="${INK.strong}">${marks}</g>`;
  const word = `<text x="${textX}" y="${baseline}" font-size="${WORDMARK.size}" font-weight="500" fill="${INK.strong}">Shinsa</text>`;
  if (!pill) return `${mark}${word}`;
  const pillX = textX + WORDMARK.width + PILL.gap;
  const pillWidth = pill.width + PILL.padX * 2;
  const tile = `<rect x="${pillX}" y="${WORDMARK.y - PILL.height / 2}" width="${pillWidth}" height="${PILL.height}" rx="${PILL.height / 2}" fill="${pill.tile}"/>`;
  const label = `<text x="${pillX + pillWidth / 2}" y="${WORDMARK.y + PILL.size * 0.358}" font-size="${PILL.size}" font-weight="500" fill="${pill.ink}" text-anchor="middle">${pill.label}</text>`;
  return `${mark}${word}${tile}${label}`;
}

function serializeHint() {
  return `<text x="${WIDTH / 2}" y="${HINT.y}" font-size="${HINT.size}" fill="${INK.muted}" text-anchor="middle">Drag Shinsa into Applications to install</text>`;
}

function serializeBackground(channel: Channel) {
  const centerY = ICON.y + 20;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}" font-family="ABC Areal Variable">
  <defs>
    <radialGradient id="fade-gradient" cx="${WIDTH / 2}" cy="${centerY}" r="${WIDTH * 0.5}" gradientTransform="translate(0 ${centerY}) scale(1 0.62) translate(0 ${-centerY})" gradientUnits="userSpaceOnUse">
      <stop offset="0.5" stop-color="#000"/>
      <stop offset="1" stop-color="#fff"/>
    </radialGradient>
    <mask id="fade"><rect width="${WIDTH}" height="${HEIGHT}" fill="url(#fade-gradient)"/></mask>
    <linearGradient id="signal" x1="${GUIDE.start + 24}" y1="0" x2="${GUIDE.end}" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${INK.accent}" stop-opacity="0"/>
      <stop offset="1" stop-color="${INK.accent}"/>
    </linearGradient>
  </defs>
  <rect width="${WIDTH}" height="${HEIGHT}" fill="${INK.page}"/>
  ${serializeDots()}
  ${serializeEdgeTraces()}
  ${serializeGuide()}
  ${serializeWordmark(channel)}
  ${serializeHint()}
</svg>
`;
}

function run(command: string[], env: Record<string, string>) {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, ...env } });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(' ')} failed: ${result.stderr.toString()}`);
  }
}

function serializeFontConfig(cacheDir: string) {
  return `<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>${fontsDir}</dir>
  <cachedir>${cacheDir}</cachedir>
</fontconfig>
`;
}

function writeBackgrounds() {
  mkdirSync(outDir, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'shinsa-dmg-'));
  try {
    const fontConfig = join(scratch, 'fonts.conf');
    writeFileSync(fontConfig, serializeFontConfig(join(scratch, 'cache')));
    const env = { FONTCONFIG_FILE: fontConfig };
    for (const channel of CHANNELS) {
      const svgPath = join(scratch, `${channel}.svg`);
      writeFileSync(svgPath, serializeBackground(channel));
      for (const scale of [1, 2]) {
        const suffix = scale === 2 ? '@2x' : '';
        const outPath = join(outDir, `background-${channel}${suffix}.png`);
        run(['rsvg-convert', '--zoom', String(scale), svgPath, '--output', outPath], env);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

writeBackgrounds();
