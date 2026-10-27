import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { launchChrome, type ShellPage } from '../perf/shell-cdp.ts';
import {
  type RecordedFrame,
  type RecordingStep,
  resolveShotPath,
  resolveShotUrl,
  SEED_SHOTS,
  type SeedShot,
  serializeFrameList,
} from './shots.ts';

const ROOT = join(import.meta.dirname, '..', '..');
const FIXTURES = join(import.meta.dirname, 'fixtures');
const ORIGIN = Bun.argv[2] ?? null;
const ONLY = Bun.env.SEED_MEDIA_ONLY ?? '';
const FIXTURE_SETTLE_MS = 150;
const APP_SETTLE_MS = 2500;
const KEY_GAP_MS = 120;

interface Frame {
  data: string;
  sessionId: number;
  metadata: { timestamp: number };
}

function waitForLoad(page: ShellPage) {
  return new Promise<void>((resolve) => {
    const stop = page.on('Page.loadEventFired', () => {
      stop();
      resolve();
    });
  });
}

async function openShot(page: ShellPage, shot: SeedShot, url: string) {
  await page.send('Emulation.setDeviceMetricsOverride', {
    width: shot.width,
    height: shot.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await page.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-color-scheme', value: shot.theme }],
  });
  const { identifier } = await page.send<{ identifier: string }>('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('shinsa.theme', ${JSON.stringify(shot.theme)}); } catch {}`,
  });
  const loaded = waitForLoad(page);
  await page.send('Page.navigate', { url });
  await loaded;
  await page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
  const { source } = shot;
  if ('app' in source) {
    await Bun.sleep(APP_SETTLE_MS);
    for (const key of source.keys ?? '') await pressKey(page, key);
  } else if (source.centreActive) {
    await page.evaluate(
      `document.querySelector('[data-active]')?.scrollIntoView({ inline: 'center', block: 'nearest' })`
    );
  }
  await Bun.sleep(FIXTURE_SETTLE_MS);
}

async function pressKey(page: ShellPage, key: string) {
  const code = `Key${key.toUpperCase()}`;
  const keyCode = key.toUpperCase().charCodeAt(0);
  await page.send('Input.dispatchKeyEvent', {
    type: 'keyDown',
    key,
    code,
    text: key,
    windowsVirtualKeyCode: keyCode,
  });
  await page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
  await Bun.sleep(KEY_GAP_MS);
}

async function centreOf(page: ShellPage, expression: string) {
  const point = await page.evaluate<{ x: number; y: number } | null>(`(() => {
    const element = ${expression};
    if (!element) return null;
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  if (!point) throw new Error(`Nothing on the page matches ${expression}.`);
  return point;
}

async function playStep(page: ShellPage, step: RecordingStep) {
  if (step.kind === 'wait') {
    await Bun.sleep(step.ms);
    return;
  }
  if (step.kind === 'wheel') {
    const { x, y } = await centreOf(page, `document.querySelector(${JSON.stringify(step.selector)})`);
    await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    for (let index = 0; index < step.times; index += 1) {
      await page.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x,
        y,
        deltaX: step.deltaX,
        deltaY: 0,
      });
      await Bun.sleep(step.gapMs);
    }
    return;
  }
  const { x, y } = await centreOf(
    page,
    `[...document.querySelectorAll('body *')].find((node) => node.children.length === 0 && node.textContent === ${JSON.stringify(step.text)})`
  );
  await page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
  await page.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await page.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function encodeVideo(frames: readonly RecordedFrame[], end: number, shot: SeedShot, target: string) {
  const work = mkdtempSync(join(tmpdir(), 'shinsa-seed-media-'));
  const list = join(work, 'frames.txt');
  writeFileSync(list, serializeFrameList(frames, end));
  const ffmpeg = Bun.spawn(
    [
      'ffmpeg',
      '-y',
      '-loglevel',
      'error',
      '-f',
      'concat',
      '-safe',
      '0',
      '-i',
      list,
      '-vf',
      `fps=30,scale=${shot.width}:${shot.height}:flags=lanczos,format=yuv420p`,
      '-c:v',
      'libvpx-vp9',
      '-b:v',
      '0',
      '-crf',
      '36',
      '-row-mt',
      '1',
      '-an',
      target,
    ],
    { stdout: 'inherit', stderr: 'inherit' }
  );
  const code = await ffmpeg.exited;
  rmSync(work, { recursive: true, force: true });
  if (code !== 0) throw new Error(`ffmpeg could not encode ${shot.file} (exit ${code}).`);
}

async function recordShot(page: ShellPage, shot: SeedShot, url: string, target: string) {
  const frames: RecordedFrame[] = [];
  const work = mkdtempSync(join(tmpdir(), 'shinsa-seed-frames-'));
  const stop = page.on<Frame>('Page.screencastFrame', (frame) => {
    const path = join(work, `${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(path, Buffer.from(frame.data, 'base64'));
    frames.push({ path, at: frame.metadata.timestamp });
    void page.send('Page.screencastFrameAck', { sessionId: frame.sessionId });
  });
  await openShot(page, shot, url);
  await page.send('Page.startScreencast', {
    format: 'jpeg',
    quality: 92,
    maxWidth: shot.width,
    maxHeight: shot.height,
  });
  for (const step of shot.steps ?? []) await playStep(page, step);
  await page.send('Page.stopScreencast');
  stop();
  await encodeVideo(frames, Date.now() / 1000, shot, target);
  rmSync(work, { recursive: true, force: true });
}

async function captureShot(page: ShellPage, shot: SeedShot, url: string, target: string) {
  await openShot(page, shot, url);
  const { data } = await page.send<{ data: string }>('Page.captureScreenshot', { format: 'png' });
  writeFileSync(target, Buffer.from(data, 'base64'));
}

const chrome = await launchChrome(1280, 800);
try {
  await chrome.page.send('Page.enable');
  await chrome.page.send('Emulation.setScrollbarsHidden', { hidden: true });
  for (const shot of SEED_SHOTS.filter((entry) => entry.file.includes(ONLY))) {
    const url = resolveShotUrl(shot, FIXTURES, ORIGIN);
    if (!url) {
      console.log(`skipped ${shot.file}: pass the origin of a seeded Shinsa to take it`);
      continue;
    }
    const target = resolveShotPath(ROOT, shot);
    mkdirSync(dirname(target), { recursive: true });
    if (shot.steps) await recordShot(chrome.page, shot, url, target);
    else await captureShot(chrome.page, shot, url, target);
    console.log(`wrote ${target}`);
  }
} finally {
  chrome.close();
}
