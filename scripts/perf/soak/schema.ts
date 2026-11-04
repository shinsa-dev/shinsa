import { Schema } from 'effect';

export const Frames = Schema.Struct({
  clickToPaint: Schema.Number,
  longest: Schema.Number,
  over34: Schema.Number,
  frames: Schema.Number,
});
export type Frames = typeof Frames.Type;

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

export const PerformanceMetrics = Schema.Struct({
  metrics: Schema.Array(Schema.Struct({ name: Schema.String, value: Schema.Number })),
});

export const TaskRows = Schema.Struct({
  tasks: Schema.Array(Schema.Struct({ handle: Schema.String, stage: Schema.String })),
});

export class NoSoakTask extends Schema.TaggedError<NoSoakTask, { readonly brand: unique symbol }>()(
  'NoSoakTask',
  { message: Schema.String }
) {}

export const HOME_DONE = `location.pathname === '/' && !!document.querySelector('main textarea')`;

export const TRANSITIONS = [
  ['Chat', 'Overview'],
  ['Overview', 'Chat'],
  ['Chat', 'Overview'],
  ['Overview', 'Chat'],
] as const;

export const SOAK_PROBE = String.raw`(() => {
  if (window.__soak) return;
  const soak = { socket: null, lastState: null };
  window.__soak = soak;
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args);
      if (String(args[0]).includes('/ws/terminals/')) return;
      soak.socket = this;
      this.addEventListener('message', (event) => {
        const text = String(event.data);
        if (text.startsWith('{"type":"state"')) soak.lastState = text;
      });
    }
  };
  const textOf = (element) => (element.textContent || '').replace(/\s+/g, ' ').trim();
  const shown = (element) => !!element.offsetParent;
  soak.go = (path) => {
    history.pushState(null, '', path);
    dispatchEvent(new PopStateEvent('popstate'));
  };
  soak.tab = (name) => [...document.querySelectorAll('[role=tab]')].find((tab) => shown(tab) && textOf(tab) === name) || null;
  soak.selectedTab = (name) => soak.tab(name)?.getAttribute('aria-selected') === 'true';
  soak.center = (element) => {
    if (!element) return null;
    element.scrollIntoView({ block: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };
  soak.scrollUp = async (times) => {
    for (let index = 0; index < times; index += 1) {
      const scrollers = [...document.querySelectorAll('main *')].filter(
        (element) => shown(element) && element.scrollHeight > element.clientHeight + 10 && /auto|scroll/.test(getComputedStyle(element).overflowY)
      );
      for (const scroller of scrollers) {
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event('scroll'));
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  };
  soak.openFiles = async (count) => {
    const files = [...document.querySelectorAll('[role=treeitem]')].filter((row) => shown(row) && !row.hasAttribute('aria-expanded')).slice(0, count);
    for (const file of files) {
      file.click();
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return files.length;
  };
  soak.push = () => {
    if (!soak.lastState || !soak.socket) return false;
    const message = JSON.parse(soak.lastState);
    const tasks = Object.values(message.state.tasks);
    const task = tasks[tasks.length - 1];
    task.priority = task.priority === 'high' ? 'normal' : 'high';
    soak.socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
    return true;
  };
  soak.frames = (windowMs) =>
    new Promise((resolve) => {
      let startedAt = null;
      const onClick = (event) => {
        if (startedAt === null) startedAt = event.timeStamp;
      };
      addEventListener('click', onClick, { capture: true });
      let last = performance.now();
      let longest = 0;
      let over34 = 0;
      let frames = 0;
      let paintedAt = null;
      const end = last + windowMs;
      const tick = (time) => {
        const gap = time - last;
        last = time;
        frames += 1;
        if (startedAt !== null) {
          longest = Math.max(longest, gap);
          if (gap > 34) over34 += 1;
          if (paintedAt === null && soak.done && soak.done()) paintedAt = time;
        }
        if (time < end) requestAnimationFrame(tick);
        else {
          removeEventListener('click', onClick, { capture: true });
          resolve({ clickToPaint: paintedAt === null || startedAt === null ? -1 : paintedAt - startedAt, longest, over34, frames });
        }
      };
      requestAnimationFrame(tick);
    });
})()`;
