export const PROBE = `
(() => {
  const sockets = [];
  const lengths = {};
  const transcript = (runId, entry) => JSON.stringify({ type: 'transcript', runId, entries: [entry], reset: false, start: lengths[runId] ?? 0 });
  const Native = window.WebSocket;
  window.WebSocket = class extends Native {
    constructor(...args) {
      super(...args);
      sockets.push(this);
      this.addEventListener('message', (event) => {
        const data = String(event.data);
        if (data.startsWith('{"type":"state"')) window.__perf.lastState = data;
        if (data.startsWith('{"type":"transcript"')) {
          const message = JSON.parse(data);
          const from = typeof message.start === 'number' ? message.start : message.reset ? 0 : (lengths[message.runId] ?? 0);
          lengths[message.runId] = from + message.entries.length;
        }
      });
    }
  };
  const longTasks = [];
  const events = [];
  new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((list) => events.push(...list.getEntries().map((e) => ({ name: e.name, duration: e.duration, processing: e.processingEnd - e.processingStart, start: e.startTime })))).observe({ type: 'event', durationThreshold: 16, buffered: true });
  const inputs = [];
  addEventListener('input', (event) => {
    const handled = performance.now();
    requestAnimationFrame(() => setTimeout(() => inputs.push({ start: event.timeStamp, delay: handled - event.timeStamp, paint: performance.now() - event.timeStamp }), 0));
  }, true);
  const frames = [];
  new PerformanceObserver((list) => frames.push(...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration, render: e.renderStart ? e.startTime + e.duration - e.renderStart : 0, layout: e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0, scripts: e.scripts.map((s) => ({ d: s.duration, src: s.invoker + ' ' + (s.sourceFunctionName || '') })).sort((a, b) => b.d - a.d).slice(0, 3) })))).observe({ type: 'long-animation-frame', buffered: true });
  const frame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const painted = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  async function waitFor(selector, timeout = 10000) {
    const until = performance.now() + timeout;
    while (performance.now() < until) {
      if (document.querySelector(selector)) return true;
      await new Promise((resolve) => setTimeout(resolve, 2));
    }
    return false;
  }
  function since(start) {
    const tasks = longTasks.filter((task) => task.start >= start);
    return { count: tasks.length, max: Math.max(0, ...tasks.map((task) => task.duration)), total: tasks.reduce((sum, task) => sum + task.duration, 0) };
  }
  function scrollerOf(selector) {
    let node = document.querySelector(selector);
    while (node && node !== document.body) {
      const style = getComputedStyle(node);
      if (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
      node = node.parentElement;
    }
    return null;
  }
  window.__perf = {
    sockets,
    lastState: null,
    waitFor,
    async navigate(path, ready) {
      await painted();
      const start = performance.now();
      history.pushState(null, '', path);
      dispatchEvent(new PopStateEvent('popstate'));
      const found = await waitFor(ready);
      await painted();
      return { ms: performance.now() - start, found, long: since(start) };
    },
    async scroll(selector, direction, frames, step) {
      const scroller = scrollerOf(selector);
      if (!scroller) return null;
      if (direction === 'up') scroller.scrollTop = scroller.scrollHeight;
      else scroller.scrollTop = 0;
      await painted();
      await sleep(200);
      const start = performance.now();
      const deltas = [];
      const vsync = [];
      let lastFrame = await new Promise((resolve) => requestAnimationFrame(resolve));
      let last = performance.now();
      for (let index = 0; index < frames; index += 1) {
        scroller.scrollTop += direction === 'up' ? -step : step;
        const at = await new Promise((resolve) => requestAnimationFrame(resolve));
        const now = performance.now();
        deltas.push(now - last);
        vsync.push(at - lastFrame);
        last = now;
        lastFrame = at;
      }
      await painted();
      deltas.sort((a, b) => a - b);
      vsync.sort((a, b) => a - b);
      return {
        vsyncP95: vsync[Math.floor(vsync.length * 0.95)],
        vsyncMax: vsync.at(-1),
        dropped: vsync.filter((delta) => delta > 20).length,
        height: scroller.scrollHeight,
        frames: deltas.length,
        p50: deltas[Math.floor(deltas.length * 0.5)],
        p95: deltas[Math.floor(deltas.length * 0.95)],
        max: deltas.at(-1),
        over16: deltas.filter((delta) => delta > 17.5).length,
        long: since(start),
      };
    },
    async holdPlace(selector, frames, step) {
      const scroller = scrollerOf(selector);
      if (!scroller) return null;
      scroller.scrollTop = scroller.scrollHeight;
      await painted();
      await sleep(400);
      const box = scroller.getBoundingClientRect();
      const pick = () => document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      let target = pick();
      let top = target?.getBoundingClientRect().top ?? 0;
      let jumps = 0;
      let worst = 0;
      for (let index = 0; index < frames && scroller.scrollTop > 0; index += 1) {
        const before = scroller.scrollTop;
        scroller.scrollTop -= step;
        const moved = before - scroller.scrollTop;
        await frame();
        if (target?.isConnected) {
          const off = Math.abs(target.getBoundingClientRect().top - top - moved);
          if (off > 1) jumps += 1;
          worst = Math.max(worst, off);
        }
        target = pick();
        top = target?.getBoundingClientRect().top ?? 0;
      }
      return { jumps, worst };
    },
    stream(runId, perSecond, stateEverySeconds) {
      const socket = sockets.at(-1);
      let count = 0;
      const push = (data) => socket.dispatchEvent(new MessageEvent('message', { data }));
      const entries = setInterval(() => {
        count += 1;
        const at = Date.now();
        const entry = count % 3 === 0
          ? { type: 'tool_call', callId: 'stream-' + count, tool: { kind: 'read', path: 'src/streamed-' + count + '.ts', range: null }, v: 2, id: 'stream-' + count, at }
          : { type: 'agent', phase: 'interim', text: 'Streaming update ' + count + ': reading the next part of the list and checking the rows.', v: 2, id: 'stream-' + count, at };
        push(transcript(runId, entry));
      }, 1000 / perSecond);
      const states = setInterval(() => {
        if (window.__perf.lastState) push(window.__perf.lastState);
      }, stateEverySeconds * 1000);
      return () => { clearInterval(entries); clearInterval(states); return count; };
    },
    startStream(runId, perSecond, stateEverySeconds) {
      window.__perf.stopStream = window.__perf.stream(runId, perSecond, stateEverySeconds);
      window.__perf.streamStart = performance.now();
      return true;
    },
    stopStream() {
      return 0;
    },
    async pushCost(runId, times) {
      const socket = sockets.at(-1);
      const state = [];
      const transcripts = [];
      for (let index = 0; index < times; index += 1) {
        await painted();
        let start = performance.now();
        socket.dispatchEvent(new MessageEvent('message', { data: window.__perf.lastState }));
        await painted();
        state.push(performance.now() - start);
        await painted();
        const at = Date.now();
        const entry = { type: 'agent', phase: 'interim', text: 'Pushed ' + index, v: 2, id: 'push-' + index + '-' + at, at };
        start = performance.now();
        socket.dispatchEvent(new MessageEvent('message', { data: transcript(runId, entry) }));
        await painted();
        transcripts.push(performance.now() - start);
      }
      const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
      return { state: median(state), stateMax: Math.max(...state), transcript: median(transcripts), transcriptMax: Math.max(...transcripts) };
    },
    inputsSince(start) {
      return inputs.filter((entry) => entry.start >= start);
    },
    framesSince(start) {
      return frames.filter((entry) => entry.start >= start);
    },
    eventsSince(start) {
      return events.filter((event) => event.start >= start);
    },
    since,
    painted,
    sleep,
  };
})();
`;
