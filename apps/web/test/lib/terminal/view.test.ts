import { afterEach, describe, expect, it, spyOn } from 'bun:test';
import { FitAddon } from '@xterm/addon-fit';
import { readTerminalFontSize } from '@/lib/preferences/terminal.ts';
import {
  createWebglRenderer,
  resolveTerminalView,
  selectTerminalView,
  syncTerminalViews,
  type TerminalSocket,
  TerminalView,
  type TerminalViewOptions,
  WEBGL_LIMIT,
} from '@/lib/terminal/view.ts';

interface FakeSocket extends TerminalSocket {
  path: string;
  sent: (string | Uint8Array)[];
  closed: boolean;
  emit: (type: 'open' | 'message' | 'close', event?: object) => void;
}

function createSockets() {
  const sockets: FakeSocket[] = [];
  const openSocket = (path: string) => {
    const listeners = new Map<string, ((event: Event) => void)[]>();
    const socket: FakeSocket = {
      path,
      binaryType: 'blob',
      readyState: 0,
      sent: [],
      closed: false,
      send: (data) => socket.sent.push(data),
      close: () => {
        socket.closed = true;
      },
      addEventListener: (type, listener) => listeners.set(type, [...(listeners.get(type) ?? []), listener]),
      emit: (type, event = {}) => {
        if (type === 'open') Object.assign(socket, { readyState: 1 });
        if (type === 'close') Object.assign(socket, { readyState: 3 });
        for (const listener of listeners.get(type) ?? []) listener(event as Event);
      },
    };
    sockets.push(socket);
    return socket;
  };
  return { sockets, openSocket };
}

const views: TerminalView[] = [];

afterEach(() => {
  for (const view of views.splice(0)) view.dispose();
  syncTerminalViews(new Set());
  localStorage.clear();
});

function sizedHost(width = 800, height = 400) {
  const host = document.createElement('div');
  Object.defineProperty(host, 'clientWidth', { configurable: true, get: () => width });
  Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => height });
  document.body.append(host);
  return host;
}

function createView(options: Partial<TerminalViewOptions> = {}) {
  const { sockets, openSocket } = createSockets();
  const retries: (() => void)[] = [];
  const links: string[] = [];
  const view = new TerminalView({
    id: 'term-1',
    scheme: 'light',
    mac: true,
    read: () => '',
    openSocket,
    retry: (reconnect) => retries.push(reconnect),
    loadRenderer: () => null,
    observeSize: () => () => undefined,
    openLink: (url) => links.push(url),
    nextFrame: (run) => run(),
    ...options,
  });
  views.push(view);
  const socket = () => sockets.at(-1) as FakeSocket;
  return { view, sockets, socket, retries, links };
}

function write(view: TerminalView, data: string) {
  return new Promise<void>((resolve) => view.terminal.write(data, resolve));
}

function readScreen(view: TerminalView) {
  const buffer = view.terminal.buffer.active;
  return Array.from({ length: buffer.length }, (_, row) => buffer.getLine(row)?.translateToString(true) ?? '')
    .join('\n')
    .trim();
}

function frames(socket: FakeSocket) {
  return socket.sent
    .filter((frame): frame is string => typeof frame === 'string')
    .map((frame) => JSON.parse(frame));
}

function keydown(key: string, modifiers: KeyboardEventInit = {}) {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers });
}

describe('TerminalView', () => {
  it('connects to its terminal’s socket and tells the engine its colours', () => {
    const { socket } = createView();
    expect(socket().path).toBe('/ws/terminals/term-1');
    expect(socket().binaryType).toBe('arraybuffer');
    socket().emit('open');
    expect(frames(socket())).toEqual([
      { type: 'colors', colors: { foreground: '#1c1c1f', background: '#ffffff', cursor: '#2f6fec' } },
    ]);
  });

  it('starts from the screen the engine sends, at the engine’s size, then writes the output as it comes', async () => {
    const { view, socket } = createView();
    socket().emit('open');
    await write(view, 'stale');
    socket().emit('message', { data: JSON.stringify({ type: 'reset', cols: 90, rows: 20 }) });
    socket().emit('message', { data: new TextEncoder().encode('hello 日本\r\n').buffer });
    socket().emit('message', { data: JSON.stringify({ type: 'live' }) });
    socket().emit('message', { data: 'not a frame' });
    await write(view, '');
    expect(view.terminal.cols).toBe(90);
    expect(readScreen(view)).toBe('hello 日本');
  });

  it('sends a program’s binary reports byte for byte', () => {
    const { view, socket } = createView();
    socket().emit('open');
    const core = (
      view.terminal as unknown as { _core: { coreService: { triggerBinaryEvent: (data: string) => void } } }
    )._core;
    core.coreService.triggerBinaryEvent('\u001b[M\u00ff');
    expect(Array.from(socket().sent.at(-1) as Uint8Array)).toEqual([27, 91, 77, 255]);
  });

  it('sends what you type as bytes and its size when it changes', () => {
    const { view, socket } = createView();
    view.terminal.input('ls\r');
    expect(socket().sent).toEqual([]);
    socket().emit('open');
    view.terminal.input('ls\r');
    view.terminal.resize(120, 40);
    const bytes = socket().sent.filter((frame) => typeof frame !== 'string');
    expect(new TextDecoder().decode(bytes[0] as Uint8Array)).toBe('ls\r');
    expect(frames(socket()).at(-1)).toEqual({ type: 'resize', cols: 120, rows: 40 });
  });

  it('reconnects with a growing wait, and stops for a terminal that is closed', () => {
    const { socket, sockets, retries, view } = createView();
    socket().emit('close', { code: 1006 });
    expect(view.connection).toBe('closed');
    retries[0]?.();
    expect(sockets).toHaveLength(2);
    socket().emit('open');
    expect(view.connection).toBe('open');
    sockets[0]?.emit('close', { code: 1006 });
    expect(retries).toHaveLength(1);
    socket().emit('close', { code: 4404 });
    expect(view.connection).toBe('gone');
    expect(retries).toHaveLength(1);
  });

  it('does not reconnect once disposed', () => {
    const { socket, retries, view } = createView();
    socket().emit('close', { code: 1006 });
    view.dispose();
    retries[0]?.();
    socket().emit('close', { code: 1006 });
    expect(retries).toHaveLength(1);
    expect(socket().closed).toBe(true);
  });

  it('mounts into a host, moves to another and keeps its renderer when it is hidden', () => {
    const renderers: string[] = [];
    let observed = 0;
    let stopped = 0;
    const { view } = createView({
      loadRenderer: () => {
        renderers.push('webgl');
        return { dispose: () => renderers.push('disposed') };
      },
      observeSize: (_element, onResize) => {
        observed += 1;
        onResize();
        return () => {
          stopped += 1;
        };
      },
    });
    const first = document.createElement('div');
    const second = document.createElement('div');
    document.body.append(first, second);
    view.mount(first);
    view.mount(first);
    expect(first.querySelector('.xterm')).not.toBeNull();
    view.mount(second);
    expect(second.querySelector('.xterm')).not.toBeNull();
    expect(renderers).toEqual(['webgl']);
    view.unmount();
    view.unmount();
    expect(renderers).toEqual(['webgl']);
    expect(view.rendering).toBe(true);
    expect([observed, stopped]).toEqual([3, 3]);
    view.releaseRenderer();
    expect(renderers).toEqual(['webgl', 'disposed']);
    view.focus();
    first.remove();
    second.remove();
  });

  it('releases the renderer of the terminal shown longest ago once more than the limit are shown', () => {
    const hosts: HTMLElement[] = [];
    const released: string[] = [];
    const shown = Array.from({ length: WEBGL_LIMIT + 1 }, (_, index) => {
      const { openSocket } = createSockets();
      const view = resolveTerminalView({
        id: `many-${index}`,
        scheme: 'light',
        mac: true,
        read: () => '',
        openSocket,
        observeSize: () => () => undefined,
        loadRenderer: () => ({ dispose: () => released.push(`many-${index}`) }),
      });
      const host = document.createElement('div');
      document.body.append(host);
      hosts.push(host);
      view.mount(host);
      return view;
    });
    expect(released).toEqual(['many-0']);
    expect(shown[0]?.rendering).toBe(false);
    shown[1]?.mount(hosts[1] as HTMLElement);
    shown[0]?.mount(hosts[0] as HTMLElement);
    expect(released).toEqual(['many-0', 'many-2']);
    for (const host of hosts) host.remove();
  });

  it('fits to its host only when the host’s size changed, and again after the screen arrives', async () => {
    const { view, socket } = createView();
    const host = sizedHost();
    const fit = spyOn(FitAddon.prototype, 'fit');
    view.mount(host);
    view.fit();
    expect(fit).toHaveBeenCalledTimes(1);
    socket().emit('open');
    socket().emit('message', { data: JSON.stringify({ type: 'reset', cols: 90, rows: 20 }) });
    socket().emit('message', { data: JSON.stringify({ type: 'live' }) });
    await write(view, '');
    expect(fit).toHaveBeenCalledTimes(2);
    const empty = sizedHost(0, 0);
    view.mount(empty);
    expect(fit).toHaveBeenCalledTimes(2);
    fit.mockRestore();
    host.remove();
    empty.remove();
  });

  it('sends the line-editing keys a Mac terminal has, scrolls, clears and changes the font size', async () => {
    const { view, socket } = createView();
    const host = sizedHost();
    view.mount(host);
    socket().emit('open');
    const textarea = view.terminal.textarea as HTMLTextAreaElement;
    const bytes = () =>
      socket()
        .sent.filter((frame) => typeof frame !== 'string')
        .map((frame) => new TextDecoder().decode(frame as Uint8Array));
    textarea.dispatchEvent(keydown('Backspace', { metaKey: true }));
    textarea.dispatchEvent(keydown('ArrowLeft', { altKey: true }));
    textarea.dispatchEvent(keydown('Enter', { shiftKey: true }));
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', shiftKey: true, bubbles: true }));
    expect(bytes()).toEqual(['\u0015', '\u001bb', '\u001b\r']);
    const copy = keydown('c', { metaKey: true });
    textarea.dispatchEvent(copy);
    expect(copy.defaultPrevented).toBe(true);
    const top = spyOn(view.terminal, 'scrollToTop');
    const bottom = spyOn(view.terminal, 'scrollToBottom');
    const pages = spyOn(view.terminal, 'scrollPages');
    textarea.dispatchEvent(keydown('Home', { metaKey: true }));
    textarea.dispatchEvent(keydown('PageDown', { metaKey: true }));
    textarea.dispatchEvent(keydown('PageUp', { metaKey: true }));
    textarea.dispatchEvent(keydown('End', { metaKey: true }));
    expect([top.mock.calls.length, bottom.mock.calls.length, pages.mock.calls]).toEqual([1, 1, [[1], [-1]]]);
    textarea.dispatchEvent(keydown('=', { metaKey: true }));
    expect(readTerminalFontSize()).toBe(13);
    expect(view.terminal.options.fontSize).toBe(13);
    textarea.dispatchEvent(keydown('l', { metaKey: true }));
    expect(frames(socket()).at(-1)).toEqual({ type: 'clear' });
    expect(bytes().at(-1)).toBe('\u000c');
    await write(view, '\u001b[?1049h');
    view.clear();
    expect(bytes().at(-1)).toBe('\u000c');
    host.remove();
  });

  it('keeps Shinsa’s ⌘ keys out of the shell and the shell’s Control keys out of Shinsa', () => {
    const { view } = createView();
    const host = document.createElement('div');
    document.body.append(host);
    view.mount(host);
    const heard: string[] = [];
    const listener = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener('keydown', listener);
    const textarea = view.terminal.textarea as HTMLTextAreaElement;
    textarea.dispatchEvent(keydown('k', { ctrlKey: true }));
    textarea.dispatchEvent(keydown('k', { metaKey: true }));
    expect(heard).toEqual(['k']);
    const find = keydown('f', { metaKey: true });
    textarea.dispatchEvent(find);
    expect(find.defaultPrevented).toBe(true);
    expect(view.findOpen).toBe(true);
    textarea.dispatchEvent(new KeyboardEvent('keyup', { key: 'f', metaKey: true, bubbles: true }));
    const selectAll = keydown('a', { metaKey: true });
    textarea.dispatchEvent(selectAll);
    expect(selectAll.defaultPrevented).toBe(true);
    window.removeEventListener('keydown', listener);
    host.remove();
  });

  it('finds in the scrollback in the Code tab’s find colours, counts the results and clears them when closed', async () => {
    const tokens: Record<string, string> = {
      '--terminal-find-match': '#ffcc0026',
      '--terminal-find-active': '#ffcc00',
    };
    const { view } = createView({ read: (name) => tokens[name] ?? '' });
    const host = document.createElement('div');
    document.body.append(host);
    view.mount(host);
    await write(view, 'ready on :3000\r\nready again\r\n');
    const changes: number[] = [];
    const stop = view.subscribe(() => changes.push(1));
    expect(view.find('ready', { caseSensitive: false, wholeWord: false, regex: false })).toBe(true);
    expect(view.results).toEqual({ index: 0, count: 2 });
    expect(view.find('ready', { caseSensitive: false, wholeWord: false, regex: false }, true)).toBe(true);
    expect(view.find('', { caseSensitive: false, wholeWord: false, regex: false })).toBe(false);
    expect(view.results).toBeNull();
    view.openFind();
    view.closeFind();
    expect(view.findOpen).toBe(false);
    expect(changes.length).toBeGreaterThan(0);
    stop();
    host.remove();
  });

  it('opens links in the browser through the handler it was given', async () => {
    const { view, links } = createView();
    const options = view.terminal.options.linkHandler;
    options?.activate(new MouseEvent('click'), 'https://example.com', {
      start: { x: 1, y: 1 },
      end: { x: 1, y: 1 },
    });
    expect(links).toEqual(['https://example.com']);
  });

  it('follows the colour scheme, and does nothing when it did not change', () => {
    const { view, socket } = createView();
    socket().emit('open');
    const sent = socket().sent.length;
    view.updateScheme('light');
    expect(socket().sent).toHaveLength(sent);
    view.updateScheme('dark');
    expect(socket().sent).toHaveLength(sent + 1);
    expect(view.background).toBeNull();
  });
});

describe('the views kept across pages', () => {
  it('keeps one view per terminal and drops the ones whose terminal closed', () => {
    const { openSocket } = createSockets();
    const options = {
      scheme: 'light' as const,
      mac: true,
      read: () => '',
      openSocket,
      loadRenderer: () => null,
    };
    const first = resolveTerminalView({ ...options, id: 'a' });
    expect(resolveTerminalView({ ...options, id: 'a' })).toBe(first);
    resolveTerminalView({ ...options, id: 'b' });
    syncTerminalViews(new Set(['b']));
    expect(selectTerminalView('a')).toBeNull();
    expect(selectTerminalView('b')).not.toBeNull();
  });
});

describe('the defaults it runs with in the page', () => {
  it('has no WebGL renderer where the browser has no WebGL, and opens sockets and links the page’s way', () => {
    const open = spyOn(window, 'open').mockReturnValue(null);
    const sockets: string[] = [];
    const RealSocket = globalThis.WebSocket;
    const closes: ((event: Event) => void)[] = [];
    globalThis.WebSocket = class {
      binaryType = 'blob';
      readyState = 0;
      constructor(url: string) {
        sockets.push(url);
      }
      addEventListener(type: string, listener: (event: Event) => void) {
        if (type === 'close') closes.push(listener);
      }
      send() {}
      close() {}
    } as unknown as typeof WebSocket;
    const timers = spyOn(globalThis, 'setTimeout').mockImplementation(((run: () => void) => {
      run();
      return 0;
    }) as unknown as typeof setTimeout);
    const view = new TerminalView({ id: 'x', scheme: 'dark', mac: false });
    views.push(view);
    expect(sockets).toEqual(['ws://localhost/ws/terminals/x']);
    closes[0]?.({ code: 1006 } as unknown as Event);
    timers.mockRestore();
    expect(sockets).toHaveLength(2);
    view.terminal.options.linkHandler?.activate(new MouseEvent('click'), 'https://a.example', {
      start: { x: 1, y: 1 },
      end: { x: 1, y: 1 },
    });
    expect(open).toHaveBeenCalledWith('https://a.example', '_blank', 'noopener');
    const host = document.createElement('div');
    document.body.append(host);
    view.mount(host);
    expect(createWebglRenderer(view.terminal)).toBeNull();
    host.remove();
    globalThis.WebSocket = RealSocket;
    open.mockRestore();
  });
});
