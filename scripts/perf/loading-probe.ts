export const LOADING_PROBE = String.raw`(() => {
  if (window.__loading) return;
  const probe = { seen: [], open: new Map(), step: 'load', stepAt: performance.now(), lastState: null };
  window.__loading = probe;

  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        const text = String(event.data);
        if (text.startsWith('{"type":"state"')) probe.lastState = text;
      });
    }
  };

  const BLANK = 'blank: ';
  const WAIT_TEXT = /^(Reading|Loading|Opening|Searching)\b.*…?$/;

  function isShown(element) {
    if (!element.isConnected) return false;
    if (typeof element.checkVisibility === 'function' && !element.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    return rect.bottom > 0 && rect.right > 0 && rect.top < innerHeight && rect.left < innerWidth;
  }

  function describe(element) {
    const holder = element.closest('[data-loading-state]') || element.parentElement || element;
    return (holder.getAttribute('data-loading-state') || holder.textContent || element.getAttribute('aria-label') || 'spinner').replace(/\s+/g, ' ').trim().slice(0, 80);
  }

  function listWaits() {
    const found = new Map();
    for (const element of document.querySelectorAll('[data-loading-state]')) {
      if (isShown(element)) found.set(element, describe(element));
    }
    for (const element of document.querySelectorAll('[data-loading-pending]')) {
      if (element.checkVisibility()) found.set(element, BLANK + element.getAttribute('data-loading-pending'));
    }
    for (const element of document.querySelectorAll('[data-slot=spinner]')) {
      if (element.closest('button, [aria-label=Progress], [data-loading-state], [data-loading-pending]')) continue;
      if (isShown(element)) found.set(element.parentElement || element, describe(element));
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent || '').trim();
      if (!text.endsWith('…') || !WAIT_TEXT.test(text)) continue;
      const element = node.parentElement;
      if (!element || element.closest('[data-loading-state], [data-loading-pending], [contenteditable], .cm-editor, input, textarea, [role=option], [role=menuitem], [data-shimmer]')) continue;
      if (getComputedStyle(element).backgroundClip === 'text') continue;
      const holder = element.parentElement?.querySelector(':scope > [data-slot=spinner]') ? element.parentElement : element;
      if (isShown(element) && !found.has(holder)) found.set(holder, text.slice(0, 80));
    }
    return found;
  }

  function scan() {
    const now = performance.now();
    const found = listWaits();
    for (const [element, label] of found) {
      if (!probe.open.has(element)) probe.open.set(element, { label, step: probe.step, at: now - probe.stepAt, startedAt: now });
    }
    for (const [element, entry] of probe.open) {
      if (found.has(element)) continue;
      probe.open.delete(element);
      probe.seen.push({ label: entry.label, step: entry.step, at: entry.at, duration: now - entry.startedAt });
    }
  }

  function loop() {
    if (document.body) scan();
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
  new MutationObserver(() => { if (document.body) scan(); }).observe(document, { childList: true, subtree: true, characterData: true, attributes: true });

  probe.begin = (step) => {
    probe.step = step;
    probe.stepAt = performance.now();
    return true;
  };

  probe.flush = () => {
    const now = performance.now();
    const still = [...probe.open.values()].map((entry) => ({ label: entry.label, step: entry.step, at: entry.at, duration: now - entry.startedAt, open: true }));
    return [...probe.seen, ...still];
  };

  probe.textOf = (element) => (element.textContent || '').replace(/\s+/g, ' ').trim();
  probe.byText = (selector, text) => [...document.querySelectorAll(selector)].find((element) => probe.textOf(element) === text) || null;
  probe.byPrefix = (selector, pattern) => [...document.querySelectorAll(selector)].find((element) => new RegExp(pattern).test(probe.textOf(element))) || null;
  probe.visible = (selector) => [...document.querySelectorAll(selector)].filter((element) => isShown(element));
  probe.rendered = (selector) => [...document.querySelectorAll(selector)].filter((element) => element.checkVisibility());
  probe.tab = (name) => probe.visible('[role=tab]').find((element) => probe.textOf(element) === name) || null;
  probe.selectedTab = (name) => probe.tab(name)?.getAttribute('aria-selected') === 'true';

  probe.center = (expression) => {
    const element = (0, eval)(expression);
    if (!element) return null;
    element.scrollIntoView({ block: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  probe.pickTasks = () => {
    if (!probe.lastState) return [];
    const { state } = JSON.parse(probe.lastState);
    return Object.values(state.tasks)
      .filter((task) => task.repoId && task.handle)
      .map((task) => ({ handle: task.handle, id: task.id, report: task.report !== null && task.report !== undefined, stage: task.stage }))
      .sort((a, b) => Number(b.report) - Number(a.report));
  };
})()`;
