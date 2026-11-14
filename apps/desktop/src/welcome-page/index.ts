import {
  createMeshShader,
  createShader,
  type PaletteName,
  playSweep,
  type ShaderController,
  type SweepHandle,
} from 'glimm';

const STAGE = { intro: 'intro', choice: 'choice', leaving: 'leaving' } as const;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const DARK = '(prefers-color-scheme: dark)';

const PALETTES: ReadonlySet<string> = new Set([
  'spectrum',
  'prism',
  'berry',
  'lagoon',
  'citrus',
  'azure',
  'ember',
]);

const body = document.body;

const reduced = matchMedia(REDUCED_MOTION).matches;

const brightness = matchMedia(DARK).matches ? 0.85 : 1;

const sweepCanvas = document.querySelector<HTMLCanvasElement>('#sweep');

const shineCanvas = document.querySelector<HTMLCanvasElement>('#shine');

const running: SweepHandle[] = [];

let sweep: ShaderController | null = null;

function selectSweep() {
  if (reduced || !sweepCanvas) return null;
  sweep ??= createShader({ canvas: sweepCanvas, brightness, swellAmount: 0.8 });
  return sweep;
}

function isPalette(name: string | undefined): name is PaletteName {
  return name !== undefined && PALETTES.has(name);
}

function showChoice() {
  if (body.dataset.stage !== STAGE.intro) return;
  body.dataset.stage = STAGE.choice;
  document.querySelector<HTMLElement>('.card')?.focus({ preventScroll: true });
}

function skipIntro() {
  for (const handle of running.splice(0)) handle.cancel();
  showChoice();
}

function shineMark() {
  if (reduced || !shineCanvas) return;
  const shine = createShader({ canvas: shineCanvas, brightness, feather: 18, bandTight: 18 });
  if (!shine) return;
  running.push(
    playSweep(shine, {
      palette: 'prism',
      direction: 'ltr',
      sweepMs: 1000,
      peakAlpha: 0.9,
      easing: 'easeInOutCubic',
      onComplete: () => shine.destroy(),
    })
  );
}

function revealChoice() {
  if (body.dataset.stage !== STAGE.intro) return;
  const canvas = sweepCanvas;
  const mesh =
    reduced || !canvas
      ? null
      : createMeshShader({
          canvas,
          brightness,
          elevation: 0.26,
          ideas: { bloom: 1, sparkles: 1, chromaticDispersion: 1, curlWake: 1, refraction: 1 },
        });
  if (!mesh) return showChoice();
  running.push(
    playSweep(mesh, {
      palette: 'spectrum',
      direction: 'ltr',
      sweepMs: 1700,
      outroMs: 320,
      midpoint: 0.5,
      easing: 'easeInOutQuint',
      waveAmount: 1.2,
      swellAmount: 1,
      onMidpoint: showChoice,
      onComplete: () => mesh.destroy(),
    })
  );
}

function leaveTo(card: HTMLAnchorElement) {
  const target = card.href;
  if (body.dataset.stage === STAGE.leaving) return;
  body.dataset.stage = STAGE.leaving;
  const controller = selectSweep();
  if (!controller) {
    location.href = target;
    return;
  }
  const palette = card.dataset.palette;
  playSweep(controller, {
    palette: isPalette(palette) ? palette : 'azure',
    direction: 'ttb',
    sweepMs: 1250,
    easing: 'easeInOutCubic',
    waveAmount: 0.8,
    onComplete: () => {
      location.href = target;
    },
  });
}

function followPointer(card: HTMLAnchorElement, event: PointerEvent) {
  const box = card.getBoundingClientRect();
  card.style.setProperty('--x', `${event.clientX - box.left}px`);
  card.style.setProperty('--y', `${event.clientY - box.top}px`);
}

for (const card of document.querySelectorAll<HTMLAnchorElement>('.card')) {
  card.addEventListener('pointermove', (event) => followPointer(card, event));
  card.addEventListener('click', (event) => {
    event.preventDefault();
    leaveTo(card);
  });
}

document.querySelector('.piece:last-child')?.addEventListener('animationend', shineMark, { once: true });

document.querySelector('#cue')?.addEventListener('animationend', revealChoice, { once: true });

document.addEventListener('pointerdown', (event) => {
  if (body.dataset.stage === STAGE.intro && !(event.target instanceof HTMLAnchorElement)) skipIntro();
});

document.addEventListener('keydown', (event) => {
  if (
    body.dataset.stage === STAGE.intro &&
    (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape')
  )
    skipIntro();
});

if (reduced) showChoice();
