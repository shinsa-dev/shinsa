import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { BunRuntime } from '@effect/platform-bun';
import { Clock, Config, Console, Duration, Effect, Fiber, Ref, Schema, Stream } from 'effect';
import { ChildProcess, ChildProcessSpawner } from 'effect/process';
import { type CdpEvent, type CdpPage, Chromium, ChromiumLayer } from '../kit/chromium/index.ts';
import { reportFailure } from '../kit/script.ts';
import {
  APP_SETTLE,
  BROWSER_WINDOW,
  Captured,
  FIXTURE_SETTLE,
  Identified,
  KEY_GAP,
  PagePoint,
  ScreencastFrame,
  SHOT_SCALE,
  ShotEncodeFailed,
  ShotTargetMissing,
} from './schema.ts';
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

const program = Effect.gen(function* () {
  const chromium = yield* Chromium;
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const origin = Bun.argv[2] ?? null;
  const only = yield* Config.String('SEED_MEDIA_ONLY').pipe(Config.withDefault(''));
  const decodeFrame = Schema.decodeUnknownEffect(ScreencastFrame);

  const pressKey = Effect.fn('SeedMedia.pressKey')(function* (page: CdpPage, key: string) {
    const code = `Key${key.toUpperCase()}`;
    const keyCode = key.toUpperCase().charCodeAt(0);
    yield* page.send('Input.dispatchKeyEvent', {
      type: 'keyDown',
      key,
      code,
      text: key,
      windowsVirtualKeyCode: keyCode,
    });
    yield* page.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, windowsVirtualKeyCode: keyCode });
    yield* Effect.sleep(KEY_GAP);
  });

  const openShot = Effect.fn('SeedMedia.openShot')(function* (page: CdpPage, shot: SeedShot, url: string) {
    yield* page.send('Emulation.setDeviceMetricsOverride', {
      width: shot.width,
      height: shot.height,
      deviceScaleFactor: SHOT_SCALE,
      mobile: false,
    });
    yield* page.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-color-scheme', value: shot.theme }],
    });
    const { identifier } = yield* page.request(
      'Page.addScriptToEvaluateOnNewDocument',
      { source: `try { localStorage.setItem('shinsa.theme', ${JSON.stringify(shot.theme)}); } catch {}` },
      Identified
    );
    yield* Effect.scoped(
      Effect.gen(function* () {
        const loads = yield* page.subscribe('Page.loadEventFired');
        const loaded = yield* Effect.forkScoped(Stream.runHead(loads));
        yield* page.send('Page.navigate', { url });
        yield* Fiber.join(loaded);
      })
    );
    yield* page.send('Page.removeScriptToEvaluateOnNewDocument', { identifier });
    const { source } = shot;
    if ('app' in source) {
      yield* Effect.sleep(APP_SETTLE);
      for (const key of source.keys ?? '') yield* pressKey(page, key);
    } else if (source.centreActive) {
      yield* page.evaluate(
        `document.querySelector('[data-active]')?.scrollIntoView({ inline: 'center', block: 'nearest' })`,
        Schema.Unknown
      );
    }
    yield* Effect.sleep(FIXTURE_SETTLE);
  });

  const centreOf = Effect.fn('SeedMedia.centreOf')(function* (page: CdpPage, expression: string) {
    const point = yield* page.evaluate(
      `(() => {
    const element = ${expression};
    if (!element) return null;
    element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`,
      PagePoint
    );
    if (!point)
      return yield* new ShotTargetMissing({ message: `Nothing on the page matches ${expression}.` });
    return point;
  });

  const playStep = Effect.fn('SeedMedia.playStep')(function* (page: CdpPage, step: RecordingStep) {
    if (step.kind === 'wait') return yield* Effect.sleep(Duration.millis(step.ms));
    if (step.kind === 'wheel') {
      const { x, y } = yield* centreOf(page, `document.querySelector(${JSON.stringify(step.selector)})`);
      yield* page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      for (let index = 0; index < step.times; index += 1) {
        yield* page.send('Input.dispatchMouseEvent', {
          type: 'mouseWheel',
          x,
          y,
          deltaX: step.deltaX,
          deltaY: 0,
        });
        yield* Effect.sleep(Duration.millis(step.gapMs));
      }
      return;
    }
    const { x, y } = yield* centreOf(
      page,
      `[...document.querySelectorAll('body *')].find((node) => node.children.length === 0 && node.textContent === ${JSON.stringify(step.text)})`
    );
    yield* page.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    yield* page.send('Input.dispatchMouseEvent', {
      type: 'mousePressed',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
    yield* page.send('Input.dispatchMouseEvent', {
      type: 'mouseReleased',
      x,
      y,
      button: 'left',
      clickCount: 1,
    });
  });

  const createWorkDirectory = (prefix: string) =>
    Effect.acquireRelease(
      Effect.sync(() => mkdtempSync(join(tmpdir(), prefix))),
      (directory) => Effect.sync(() => rmSync(directory, { recursive: true, force: true }))
    );

  const encodeVideo = Effect.fn('SeedMedia.encodeVideo')(function* (
    frames: readonly RecordedFrame[],
    end: number,
    shot: SeedShot,
    target: string
  ) {
    const work = yield* createWorkDirectory('shinsa-seed-media-');
    const list = join(work, 'frames.txt');
    const frameList = yield* Effect.try({
      try: () => serializeFrameList(frames, end),
      catch: () => new ShotEncodeFailed({ message: `The recording of ${shot.file} has no frames.` }),
    });
    yield* Effect.sync(() => writeFileSync(list, frameList));
    const failed = (message: string) => new ShotEncodeFailed({ message });
    const ffmpeg = yield* spawner
      .spawn(
        ChildProcess.make(
          'ffmpeg',
          [
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
            `fps=30,scale=${shot.width * SHOT_SCALE}:${shot.height * SHOT_SCALE}:flags=lanczos,format=yuv420p`,
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
          { stdin: 'ignore', stdout: 'inherit', stderr: 'inherit' }
        )
      )
      .pipe(Effect.mapError((error) => failed(`ffmpeg could not start: ${error.message}`)));
    const code = yield* ffmpeg.exitCode.pipe(Effect.mapError((error) => failed(error.message)));
    if (code !== 0) return yield* failed(`ffmpeg could not encode ${shot.file} (exit ${code}).`);
  }, Effect.scoped);

  const recordShot = Effect.fn('SeedMedia.recordShot')(function* (
    page: CdpPage,
    shot: SeedShot,
    url: string,
    target: string
  ) {
    const work = yield* createWorkDirectory('shinsa-seed-frames-');
    const frames = yield* Ref.make<RecordedFrame[]>([]);
    const screencast = yield* page.subscribe('Page.screencastFrame');
    const recordFrame = Effect.fn('SeedMedia.recordFrame')(function* (event: CdpEvent) {
      const frame = yield* decodeFrame(event.params).pipe(Effect.orDie);
      const recorded = yield* Ref.get(frames);
      const path = join(work, `${String(recorded.length).padStart(5, '0')}.jpg`);
      yield* Effect.sync(() => writeFileSync(path, Buffer.from(frame.data, 'base64')));
      yield* Ref.set(frames, [...recorded, { path, at: frame.metadata.timestamp }]);
      yield* Effect.forkScoped(
        Effect.ignore(page.send('Page.screencastFrameAck', { sessionId: frame.sessionId }))
      );
    });
    const recording = yield* screencast.pipe(Stream.runForEach(recordFrame), Effect.forkScoped);
    yield* openShot(page, shot, url);
    yield* page.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 92,
      maxWidth: shot.width * SHOT_SCALE,
      maxHeight: shot.height * SHOT_SCALE,
    });
    for (const step of shot.steps ?? []) yield* playStep(page, step);
    yield* page.send('Page.stopScreencast');
    yield* Fiber.interrupt(recording);
    const end = (yield* Clock.currentTimeMillis) / 1000;
    yield* encodeVideo(yield* Ref.get(frames), end, shot, target);
  }, Effect.scoped);

  const captureShot = Effect.fn('SeedMedia.captureShot')(function* (
    page: CdpPage,
    shot: SeedShot,
    url: string,
    target: string
  ) {
    yield* openShot(page, shot, url);
    const { data } = yield* page.request('Page.captureScreenshot', { format: 'png' }, Captured);
    yield* Effect.sync(() => writeFileSync(target, Buffer.from(data, 'base64')));
  });

  const page = yield* chromium.launch(BROWSER_WINDOW);
  yield* page.send('Page.enable');
  yield* page.send('Emulation.setScrollbarsHidden', { hidden: true });
  for (const shot of SEED_SHOTS.filter((entry) => entry.file.includes(only))) {
    const url = resolveShotUrl(shot, FIXTURES, origin);
    if (!url) {
      yield* Console.log(`skipped ${shot.file}: pass the origin of a seeded Shinsa to take it`);
      continue;
    }
    const target = resolveShotPath(ROOT, shot);
    yield* Effect.sync(() => mkdirSync(dirname(target), { recursive: true }));
    if (shot.steps) yield* recordShot(page, shot, url, target);
    else yield* captureShot(page, shot, url, target);
    yield* Console.log(`wrote ${target}`);
  }
});

program.pipe(
  Effect.scoped,
  reportFailure,
  Effect.provide(ChromiumLayer),
  BunRuntime.runMain({ disableErrorReporting: true })
);
