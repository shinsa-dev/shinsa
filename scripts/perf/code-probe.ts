export const CODE_PROBE = `
(() => {
  if (window.__code) return;
  const longTasks = [];
  new PerformanceObserver((list) => longTasks.push(...list.getEntries().map((e) => ({ start: e.startTime, duration: e.duration })))).observe({ type: 'longtask', buffered: true });
  let lastClick = 0;
  let lastOver = 0;
  addEventListener('pointerdown', (event) => { lastClick = event.timeStamp; }, true);
  addEventListener('pointerover', (event) => { lastOver = event.timeStamp; }, true);
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const TOKEN = /^cm-(selectionMatch|searchMatch|matchingBracket|nonmatchingBracket|specialChar|trailingSpace|widgetBuffer)/;
  function visibleContent(snippet) {
    for (const content of document.querySelectorAll('.cm-content')) {
      if (!content.checkVisibility({ visibilityProperty: true, opacityProperty: true })) continue;
      if (content.textContent.includes(snippet)) return content;
    }
    return null;
  }
  function isHighlighted(content) {
    let seen = 0;
    for (const span of content.querySelectorAll('.cm-line span')) {
      seen += 1;
      if (seen > 400) break;
      if (span.className && !TOKEN.test(span.className)) return true;
    }
    return false;
  }
  function work(name, start) {
    const entry = performance.getEntriesByName(name).filter((each) => each.startTime >= start - 1).at(-1);
    return entry ? Math.round(entry.duration * 10) / 10 : null;
  }
  function since(start) {
    const tasks = longTasks.filter((task) => task.start >= start);
    return { count: tasks.length, max: Math.round(Math.max(0, ...tasks.map((task) => task.duration))), total: Math.round(tasks.reduce((sum, task) => sum + task.duration, 0)) };
  }
  window.__code = {
    since,
    sleep,
    now: () => performance.now(),
    lastClick: () => lastClick,
    async watchSelector(selector, present, timeout = 8000) {
      const armed = performance.now();
      while (performance.now() - armed < timeout) {
        const at = await frame();
        if (Boolean(document.querySelector(selector)) === present) {
          const start = lastClick > armed - 2000 ? lastClick : armed;
          return { ms: Math.round((at - start) * 10) / 10, work: work('shinsa:tree-toggled', start), long: since(start).max };
        }
      }
      return { ms: null, long: since(armed).max };
    },
    async reveal(selector) {
      const viewport = document.querySelector('[role=tree]')?.closest('[data-slot=scroll-area-viewport]');
      if (viewport && !document.querySelector(selector)) viewport.scrollTop = 0;
      for (let step = 0; step < 400 && viewport && !document.querySelector(selector); step += 1) {
        viewport.scrollTop += viewport.clientHeight * 0.8;
        await frame();
        await frame();
      }
      const node = document.querySelector(selector);
      if (!node) return false;
      const box = node.getBoundingClientRect();
      if (box.top < 160 || box.bottom > innerHeight - 20) node.scrollIntoView({ block: 'center' });
      await frame();
      return true;
    },
    rect(selector) {
      const node = document.querySelector(selector);
      if (!node) return null;
      const box = node.getBoundingClientRect();
      if (box.height === 0 || box.top < 0 || box.bottom > innerHeight) return null;
      return { x: Math.round(box.left + Math.min(box.width / 2, 60)), y: Math.round(box.top + box.height / 2) };
    },
    count(selector) {
      return document.querySelectorAll(selector).length;
    },
    async navigate(path) {
      history.pushState(null, '', path);
      dispatchEvent(new PopStateEvent('popstate'));
      await frame();
      return true;
    },
    async watchOpen(snippet, timeout = 8000) {
      const armed = performance.now();
      const until = armed + timeout;
      let visible = null;
      let highlighted = null;
      while (performance.now() < until) {
        const at = await frame();
        const content = visibleContent(snippet);
        if (content && visible === null) visible = at;
        if (content && highlighted === null && isHighlighted(content)) highlighted = at;
        if (visible !== null && highlighted !== null) break;
      }
      const start = lastClick > armed - 2000 ? lastClick : armed;
      return {
        workMs: work('shinsa:code-shown', start),
        visibleMs: visible === null ? null : Math.round((visible - start) * 10) / 10,
        highlightedMs: highlighted === null ? null : Math.round((highlighted - start) * 10) / 10,
        long: since(start),
      };
    },
    async watchStyle(selector, property, frames) {
      const samples = [];
      for (let index = 0; index < frames; index += 1) {
        const at = await frame();
        const node = document.querySelector(selector);
        samples.push({ at, value: node ? getComputedStyle(node)[property] : null });
      }
      return { samples, over: lastOver, click: lastClick };
    },
    async watchCount(selector, from, timeout = 8000) {
      const start = lastClick;
      const until = performance.now() + timeout;
      while (performance.now() < until) {
        const at = await frame();
        if (document.querySelectorAll(selector).length !== from) return { ms: Math.round((at - start) * 10) / 10, long: since(start) };
      }
      return { ms: null, long: since(start) };
    },
    async frames(run) {
      const gaps = [];
      let last = await frame();
      const start = last;
      let done = false;
      run().then(() => { done = true; });
      while (!done) {
        const at = await frame();
        gaps.push(at - last);
        last = at;
      }
      gaps.sort((a, b) => a - b);
      return { frames: gaps.length, p95: Math.round(gaps[Math.floor(gaps.length * 0.95)] ?? 0), max: Math.round(gaps.at(-1) ?? 0), long: since(start) };
    },
  };
})();
`;
