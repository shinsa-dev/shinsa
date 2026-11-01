import { summarize } from './shell-stats.ts';

export interface Frames {
  clickToPaint: number;
  longest: number;
  over34: number;
  frames: number;
}

export interface SoakSample {
  lap: number;
  minutes: number;
  nodes: number;
  heapMb: number;
  idleBusy: number;
  scriptBusy: number;
  recalcsPerSecond: number;
  layoutsPerSecond: number;
  transition: Frames[];
}

const HEADER =
  '| Lap | Minutes | Elements | Heap after GC | Idle main thread | Idle script | Style recalcs/s | Layouts/s | Tab switch | Longest frame | Frames over 34 ms |';

function formatPercent(fraction: number) {
  return `${(fraction * 100).toFixed(1)}%`;
}

export function serializeSoakRow(sample: SoakSample) {
  const painted = sample.transition.map((frames) => frames.clickToPaint).filter((value) => value >= 0);
  const paint = summarize(painted).median;
  const longest = summarize(sample.transition.map((frames) => frames.longest)).median;
  const slowFrames = sample.transition.reduce((sum, frames) => sum + frames.over34, 0);
  return `| ${sample.lap} | ${sample.minutes.toFixed(1)} | ${sample.nodes} | ${sample.heapMb.toFixed(1)} MB | ${formatPercent(sample.idleBusy)} | ${formatPercent(sample.scriptBusy)} | ${sample.recalcsPerSecond.toFixed(1)} | ${sample.layoutsPerSecond.toFixed(1)} | ${paint.toFixed(1)} ms | ${longest.toFixed(1)} ms | ${slowFrames} |`;
}

export function serializeSoakTable(samples: readonly SoakSample[]) {
  return [HEADER, '|---|---|---|---|---|---|---|---|---|---|---|', ...samples.map(serializeSoakRow)].join(
    '\n'
  );
}
