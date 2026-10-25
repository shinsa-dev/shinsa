export const SHELL_PROBE = String.raw`(() => {
  if (window.__shell) return;
  const COMPONENT_TAGS = new Set([0, 1, 11, 14, 15]);
  const PERFORMED_WORK = 1;
  const perf = { commits: 0, rendered: 0, longTasks: [], step: null, socket: null, lastState: null };
  window.__shell = perf;

  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args);
      perf.socket = this;
      this.addEventListener('message', (event) => {
        const text = String(event.data);
        if (text.startsWith('{"type":"state"')) perf.lastState = text;
      });
    }
  };

  perf.push = async () => {
    const message = JSON.parse(perf.lastState);
    const tasks = Object.values(message.state.tasks);
    const task = tasks[tasks.length - 1];
    task.priority = task.priority === 'high' ? 'normal' : 'high';
    const startCommits = perf.commits;
    const startRendered = perf.rendered;
    const longTaskIndex = perf.longTasks.length;
    const startedAt = performance.now();
    perf.socket.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }));
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const paintedAt = await afterThisFrame();
    const tasksDuring = perf.longTasks.slice(longTaskIndex);
    return {
      clickToPaint: paintedAt - startedAt,
      commits: perf.commits - startCommits,
      rendered: perf.rendered - startRendered,
      longTasks: tasksDuring.length,
      longTaskTotal: tasksDuring.reduce((sum, entry) => sum + entry.duration, 0),
    };
  };

  perf.names = null;
  function nameOf(fiber) {
    const type = fiber.type;
    if (!type) return '?';
    return type.displayName || type.name || (type.render && (type.render.displayName || type.render.name)) || (type.type && (type.type.displayName || type.type.name)) || '?';
  }

  function countRendered(root) {
    let count = 0;
    const stack = [root];
    while (stack.length > 0) {
      const fiber = stack.pop();
      if (COMPONENT_TAGS.has(fiber.tag) && (fiber.alternate === null || (fiber.flags & PERFORMED_WORK) === PERFORMED_WORK)) {
        count += 1;
        if (perf.names) {
          const name = nameOf(fiber);
          perf.names[name] = (perf.names[name] || 0) + 1;
        }
      }
      const touched = !fiber.alternate || fiber.child !== fiber.alternate.child;
      if (!touched) continue;
      for (let child = fiber.child; child; child = child.sibling) stack.push(child);
    }
    return count;
  }

  const renderers = new Map();
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers,
    supportsFiber: true,
    isDisabled: false,
    inject(renderer) {
      const id = renderers.size + 1;
      renderers.set(id, renderer);
      return id;
    },
    onScheduleFiberRoot() {},
    onCommitFiberRoot(_id, root) {
      perf.commits += 1;
      perf.rendered += countRendered(root.current);
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    checkDCE() {},
  };

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) perf.longTasks.push({ start: entry.startTime, duration: entry.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}

  function afterThisFrame() {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => resolve(performance.now());
      channel.port2.postMessage(null);
    });
  }

  perf.textOf = (element) => (element.textContent || '').replace(/\s+/g, ' ').trim();
  perf.byText = (selector, text) =>
    [...document.querySelectorAll(selector)].find((element) => perf.textOf(element) === text) || null;
  perf.byPrefix = (selector, pattern) =>
    [...document.querySelectorAll(selector)].find((element) => new RegExp(pattern).test(perf.textOf(element))) || null;
  perf.tab = (name) => perf.byText('[role=tab]', name);
  perf.selectedTab = (name) => perf.tab(name)?.getAttribute('aria-selected') === 'true';

  perf.center = (expression) => {
    const element = (0, eval)(expression);
    if (!element) return null;
    element.scrollIntoView({ block: 'nearest' });
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  };

  perf.arm = (done, trigger) => {
    const startCommits = perf.commits;
    const startRendered = perf.rendered;
    const longTaskIndex = perf.longTasks.length;
    let startedAt = null;
    const onTrigger = (event) => {
      if (startedAt === null) startedAt = event.timeStamp;
    };
    addEventListener(trigger, onTrigger, { capture: true });
    const isDone = (0, eval)('() => ' + done);
    perf.step = new Promise((resolve) => {
      const deadline = performance.now() + 10000;
      const poll = async () => {
        if (startedAt !== null && isDone()) {
          const paintedAt = await afterThisFrame();
          removeEventListener(trigger, onTrigger, { capture: true });
          const tasks = perf.longTasks.slice(longTaskIndex);
          resolve({
            clickToPaint: paintedAt - startedAt,
            commits: perf.commits - startCommits,
            rendered: perf.rendered - startRendered,
            longTasks: tasks.length,
            longTaskTotal: tasks.reduce((sum, task) => sum + task.duration, 0),
          });
          return;
        }
        if (performance.now() > deadline) {
          removeEventListener(trigger, onTrigger, { capture: true });
          resolve(null);
          return;
        }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    });
    return true;
  };

  perf.idle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
})()`;
