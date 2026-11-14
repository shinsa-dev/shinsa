import { accentChain, createShader, playSweep, type ShaderController, type SweepHandle } from 'glimm';

const STAGE = { intro: 'intro', choice: 'choice', leaving: 'leaving' } as const;

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';

const DARK = '(prefers-color-scheme: dark)';

const PRIMARY_WAVE = accentChain(['#4a70fe', '#769dff', '#73c2ff']);

const WAVE = {
  bandTight: 12,
  waveAmount: 2,
  rippleAmount: 0.5,
  waveSpeed: 0.9,
  swellAmount: 0.7,
} as const;

const body = document.body;

const reduced = matchMedia(REDUCED_MOTION).matches;

const brightness = matchMedia(DARK).matches ? 0.8 : 1;

const canvas = document.querySelector<HTMLCanvasElement>('#wave');

const running: SweepHandle[] = [];

let wave: ShaderController | null = null;

function selectWave() {
  if (reduced || !canvas) return null;
  wave ??= createShader({ canvas, palette: PRIMARY_WAVE, direction: 'btt', brightness, ...WAVE });
  return wave;
}

function showChoice() {
  if (body.dataset.stage !== STAGE.intro) return;
  body.dataset.stage = STAGE.choice;
}

function skipIntro() {
  for (const handle of running.splice(0)) handle.cancel();
  wave?.setAlpha(0);
  showChoice();
}

function revealChoice() {
  if (body.dataset.stage !== STAGE.intro) return;
  const controller = selectWave();
  if (!controller) return showChoice();
  running.push(
    playSweep(controller, {
      palette: PRIMARY_WAVE,
      direction: 'btt',
      sweepMs: 1600,
      outroMs: 260,
      midpoint: 0.5,
      easing: 'easeInOutCubic',
      peakAlpha: 0.95,
      ...WAVE,
      onMidpoint: showChoice,
    })
  );
}

function leaveTo(card: HTMLAnchorElement) {
  const target = card.href;
  if (body.dataset.stage === STAGE.leaving) return;
  body.dataset.stage = STAGE.leaving;
  const controller = selectWave();
  if (!controller) {
    location.href = target;
    return;
  }
  playSweep(controller, {
    palette: PRIMARY_WAVE,
    direction: 'btt',
    sweepMs: 1200,
    easing: 'easeInOutCubic',
    peakAlpha: 0.95,
    ...WAVE,
    onComplete: () => {
      location.href = target;
    },
  });
}

for (const card of document.querySelectorAll<HTMLAnchorElement>('.card')) {
  card.addEventListener('click', (event) => {
    event.preventDefault();
    leaveTo(card);
  });
}

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
