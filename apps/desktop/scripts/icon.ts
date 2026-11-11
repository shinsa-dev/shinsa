import { join, resolve } from 'node:path';
import { BunRuntime, BunServices } from '@effect/platform-bun';
import { Effect, FileSystem } from 'effect';
import { readMarkPaths } from './kit/marks.ts';
import { reportScriptFailure } from './kit/report.ts';
import { runScriptCommand } from './kit/run.ts';
import { ScriptStepFailed } from './kit/schema.ts';

const CANVAS = 1024;

const BODY = { inset: 100, size: 824, radius: 185 };

const CORNER_EXTENT = 1.528;

const CORNER_EXPONENT = 3.3;

const CORNER_STEPS = 96;

const MARK = { size: 488, viewBox: 365 };

const ICONSET_SIZES = [16, 32, 128, 256, 512];

const BODY_INK = { top: '#fbfbfa', bottom: '#e7e7e5' };

const TRAY = { canvas: 18, mark: 13 };

const desktopDir = resolve(import.meta.dirname, '..');

const resourcesDir = join(desktopDir, 'resources');

const staticDir = join(desktopDir, 'static');

const logoPath = resolve(desktopDir, '../../packages/ui/src/components/logo.tsx');

function formatPoint(x: number, y: number) {
  return `${x.toFixed(2)} ${y.toFixed(2)}`;
}

function listCornerPoints(cornerX: number, cornerY: number, signX: number, signY: number) {
  const extent = BODY.radius * CORNER_EXTENT;
  const originX = cornerX - signX * extent;
  const originY = cornerY - signY * extent;
  const points: string[] = [];
  for (let step = 0; step <= CORNER_STEPS; step += 1) {
    const angle = (step / CORNER_STEPS) * (Math.PI / 2);
    const across = Math.cos(angle) ** (2 / CORNER_EXPONENT);
    const along = Math.sin(angle) ** (2 / CORNER_EXPONENT);
    points.push(formatPoint(originX + signX * extent * across, originY + signY * extent * along));
  }
  return points;
}

function resolveSquirclePath() {
  const start = BODY.inset;
  const end = BODY.inset + BODY.size;
  const corners = [
    listCornerPoints(end, start, 1, -1).reverse(),
    listCornerPoints(end, end, 1, 1),
    listCornerPoints(start, end, -1, 1).reverse(),
    listCornerPoints(start, start, -1, -1),
  ];
  const [first = '', ...rest] = corners.flat();
  return `M${first} ${rest.map((point) => `L${point}`).join(' ')} Z`;
}

function serializeIcon(markPaths: readonly string[]) {
  const scale = MARK.size / MARK.viewBox;
  const offset = (CANVAS - MARK.size) / 2;
  const squircle = resolveSquirclePath();
  const marks = markPaths.map((d) => `    <path d="${d}"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${BODY_INK.top}"/>
      <stop offset="1" stop-color="${BODY_INK.bottom}"/>
    </linearGradient>
    <linearGradient id="mark" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#3a3a3c"/>
      <stop offset="1" stop-color="#1c1c1e"/>
    </linearGradient>
    <filter id="shadow" x="-10%" y="-10%" width="120%" height="125%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="14"/>
      <feOffset dy="10" result="blur"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.3"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <path d="${squircle}" fill="url(#body)" filter="url(#shadow)"/>
  <path d="${squircle}" fill="none" stroke="#000" stroke-opacity="0.06" stroke-width="2"/>
  <g transform="translate(${offset} ${offset}) scale(${scale.toFixed(6)})" fill="url(#mark)">
${marks}
  </g>
</svg>
`;
}

function renderPng(svgPath: string, size: number, outPath: string) {
  return runScriptCommand([
    'rsvg-convert',
    '--width',
    String(size),
    '--height',
    String(size),
    svgPath,
    '--output',
    outPath,
  ]);
}

const writeIcon = Effect.fn('DesktopIcon.writeIcon')(function* (name: string, markPaths: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const svgPath = join(resourcesDir, `${name}.svg`);
  yield* fs.writeFileString(svgPath, serializeIcon(markPaths));
  yield* renderPng(svgPath, CANVAS, join(resourcesDir, `${name}.png`));
  const iconset = join(yield* fs.makeTempDirectoryScoped({ prefix: 'shinsa-icon-' }), 'icon.iconset');
  yield* fs.makeDirectory(iconset);
  for (const size of ICONSET_SIZES) {
    yield* renderPng(svgPath, size, join(iconset, `icon_${size}x${size}.png`));
    yield* renderPng(svgPath, size * 2, join(iconset, `icon_${size}x${size}@2x.png`));
  }
  yield* runScriptCommand([
    'iconutil',
    '--convert',
    'icns',
    iconset,
    '--output',
    join(resourcesDir, `${name}.icns`),
  ]);
}, Effect.scoped);

function serializeTrayIcon(markPaths: readonly string[]) {
  const scale = TRAY.mark / MARK.viewBox;
  const offset = (TRAY.canvas - TRAY.mark) / 2;
  const marks = markPaths.map((d) => `    <path d="${d}"/>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${TRAY.canvas}" height="${TRAY.canvas}" viewBox="0 0 ${TRAY.canvas} ${TRAY.canvas}">
  <g transform="translate(${offset} ${offset}) scale(${scale.toFixed(6)})" fill="#000">
${marks}
  </g>
</svg>
`;
}

const writeTrayIcon = Effect.fn('DesktopIcon.writeTrayIcon')(function* (markPaths: readonly string[]) {
  const fs = yield* FileSystem.FileSystem;
  const svgPath = join(yield* fs.makeTempDirectoryScoped({ prefix: 'shinsa-tray-' }), 'tray.svg');
  yield* fs.writeFileString(svgPath, serializeTrayIcon(markPaths));
  yield* renderPng(svgPath, TRAY.canvas, join(staticDir, 'trayTemplate.png'));
  yield* renderPng(svgPath, TRAY.canvas * 2, join(staticDir, 'trayTemplate@2x.png'));
}, Effect.scoped);

Effect.gen(function* () {
  const markPaths = yield* readMarkPaths(logoPath);
  yield* writeIcon('icon', markPaths);
  yield* writeTrayIcon(markPaths);
}).pipe(
  Effect.catchTag('PlatformError', (error) => Effect.fail(new ScriptStepFailed({ message: error.message }))),
  reportScriptFailure,
  Effect.provide(BunServices.layer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
