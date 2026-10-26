import { parseTerminalServerFrame, type TerminalAppearance, type TerminalClientFrame } from '@shinsa/core';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { type IDisposable, Terminal } from '@xterm/xterm';
import type { SearchOptions } from '@/lib/code/search.ts';
import { createSignal } from '@/lib/signal.ts';
import { resolveTerminalKey } from '@/lib/terminal/keys.ts';
import { silenceEngineAnswers } from '@/lib/terminal/replies.ts';
import {
  type ColorScheme,
  readDocumentVariable,
  resolveReplyColors,
  resolveTerminalOptions,
  type VariableReader,
} from '@/lib/terminal/theme.ts';

export interface TerminalSocket {
  binaryType: BinaryType;
  readonly readyState: number;
  send: (data: string | Uint8Array<ArrayBuffer>) => void;
  close: () => void;
  addEventListener: (type: 'open' | 'message' | 'close', listener: (event: Event) => void) => void;
}

type TerminalRenderer = (terminal: Terminal) => IDisposable | null;

type SizeObserver = (element: HTMLElement, onResize: () => void) => () => void;

export interface TerminalViewOptions {
  id: string;
  appearance: TerminalAppearance;
  scheme: ColorScheme;
  mac: boolean;
  read?: VariableReader;
  openSocket?: (path: string) => TerminalSocket;
  retry?: (reconnect: () => void, delayMs: number) => void;
  loadRenderer?: TerminalRenderer;
  observeSize?: SizeObserver;
  openLink?: (url: string) => void;
}

export interface FindResults {
  index: number;
  count: number;
}

export type TerminalConnection = 'connecting' | 'open' | 'closed' | 'gone';

const OPEN = 1;

const GONE = 4404;

const RETRY_STEPS_MS = [250, 1000, 2000, 5000];

const ENCODER = new TextEncoder();

const FIND_DECORATIONS = {
  matchOverviewRuler: '#888888',
  activeMatchColorOverviewRuler: '#2f6fec',
  matchBackground: '#ffd25e66',
  activeMatchBackground: '#ff9f0a',
};

function openTerminalSocket(path: string): TerminalSocket {
  const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
  return new WebSocket(`${protocol}://${location.host}${path}`);
}

function retryLater(reconnect: () => void, delayMs: number) {
  setTimeout(reconnect, delayMs);
}

export function createWebglRenderer(terminal: Terminal): IDisposable | null {
  try {
    const renderer = new WebglAddon();
    renderer.onContextLoss(renderer.dispose.bind(renderer));
    terminal.loadAddon(renderer);
    return renderer;
  } catch {
    return null;
  }
}

function observeElementSize(element: HTMLElement, onResize: () => void) {
  const observer = new ResizeObserver(onResize);
  observer.observe(element);
  return () => observer.disconnect();
}

function openInBrowser(url: string) {
  window.open(url, '_blank', 'noopener');
}

function encodeBinary(data: string) {
  return Uint8Array.from(data, (character) => character.charCodeAt(0) & 0xff);
}

export class TerminalView {
  readonly id: string;
  readonly terminal: Terminal;
  readonly #options: TerminalViewOptions;
  readonly #fit = new FitAddon();
  readonly #search = new SearchAddon();
  readonly #signal = createSignal();
  #socket: TerminalSocket | null = null;
  #connection: TerminalConnection = 'connecting';
  #attempt = 0;
  #disposed = false;
  #renderer: IDisposable | null = null;
  #stopObserving: (() => void) | null = null;
  #findOpen = false;
  #results: FindResults | null = null;
  #scheme: ColorScheme;
  #appearance: TerminalAppearance;

  constructor(options: TerminalViewOptions) {
    this.id = options.id;
    this.#options = options;
    this.#scheme = options.scheme;
    this.#appearance = options.appearance;
    const openLink = options.openLink ?? openInBrowser;
    const activate = (_event: MouseEvent, uri: string) => openLink(uri);
    this.terminal = new Terminal({
      ...this.#resolveOptions(),
      linkHandler: { activate, allowNonHttpProtocols: false },
    });
    this.terminal.loadAddon(this.#fit);
    this.terminal.loadAddon(this.#search);
    this.terminal.loadAddon(new Unicode11Addon());
    this.terminal.loadAddon(new WebLinksAddon(activate));
    this.terminal.unicode.activeVersion = '11';
    this.#search.onDidChangeResults(({ resultIndex, resultCount }) => {
      this.#results = { index: resultIndex, count: resultCount };
      this.#signal.publish();
    });
    silenceEngineAnswers(this.terminal.parser);
    this.terminal.attachCustomKeyEventHandler((event) => this.#handleKey(event));
    this.terminal.onData((data) => this.#send(ENCODER.encode(data)));
    this.terminal.onBinary((data) => this.#send(encodeBinary(data)));
    this.terminal.onResize(({ cols, rows }) => this.#sendFrame({ type: 'resize', cols, rows }));
    this.#connect();
  }

  subscribe = (listener: () => void) => this.#signal.subscribe(listener);

  get connection() {
    return this.#connection;
  }

  get findOpen() {
    return this.#findOpen;
  }

  get results() {
    return this.#results;
  }

  #resolveOptions() {
    return resolveTerminalOptions(this.#appearance, this.#scheme, this.#options.read ?? readDocumentVariable);
  }

  #setConnection(connection: TerminalConnection) {
    this.#connection = connection;
    this.#signal.publish();
  }

  #connect() {
    const socket = (this.#options.openSocket ?? openTerminalSocket)(
      `/ws/terminals/${encodeURIComponent(this.id)}`
    );
    socket.binaryType = 'arraybuffer';
    this.#socket = socket;
    socket.addEventListener('open', () => {
      this.#attempt = 0;
      this.#setConnection('open');
      this.#sendColors();
    });
    socket.addEventListener('message', (event) => this.#receive((event as MessageEvent).data));
    socket.addEventListener('close', (event) => {
      if (this.#disposed || this.#socket !== socket) return;
      if ((event as CloseEvent).code === GONE) {
        this.#setConnection('gone');
        return;
      }
      this.#setConnection('closed');
      const delay = RETRY_STEPS_MS[Math.min(this.#attempt, RETRY_STEPS_MS.length - 1)] ?? 5000;
      this.#attempt += 1;
      (this.#options.retry ?? retryLater)(() => {
        if (!this.#disposed) this.#connect();
      }, delay);
    });
  }

  #receive(data: unknown) {
    if (typeof data !== 'string') {
      this.terminal.write(new Uint8Array(data as ArrayBuffer));
      return;
    }
    const frame = parseTerminalServerFrame(data);
    if (frame?.type === 'reset') {
      this.terminal.reset();
      this.terminal.resize(frame.cols, frame.rows);
    }
    if (frame?.type === 'live') this.terminal.write('', () => this.fit());
  }

  #send(data: Uint8Array<ArrayBuffer>) {
    if (this.#socket?.readyState === OPEN) this.#socket.send(data);
  }

  #sendFrame(frame: TerminalClientFrame) {
    if (this.#socket?.readyState === OPEN) this.#socket.send(JSON.stringify(frame));
  }

  #sendColors() {
    this.#sendFrame({ type: 'colors', colors: resolveReplyColors(this.terminal.options.theme ?? {}) });
  }

  #handleKey(event: KeyboardEvent) {
    const action = resolveTerminalKey(event, this.#options.mac, this.terminal.hasSelection());
    if (action === 'shell') {
      event.stopPropagation();
      return true;
    }
    if (event.type !== 'keydown') return false;
    if (action === 'find') {
      event.preventDefault();
      this.openFind();
    }
    if (action === 'select-all') {
      event.preventDefault();
      this.terminal.selectAll();
    }
    return false;
  }

  mount(host: HTMLElement) {
    const element = this.terminal.element;
    if (!element) this.terminal.open(host);
    else if (element.parentElement !== host) host.append(element);
    this.#renderer ??= (this.#options.loadRenderer ?? createWebglRenderer)(this.terminal);
    this.#stopObserving?.();
    this.#stopObserving = (this.#options.observeSize ?? observeElementSize)(host, () => this.fit());
    this.fit();
  }

  unmount() {
    this.#stopObserving?.();
    this.#stopObserving = null;
    this.#renderer?.dispose();
    this.#renderer = null;
  }

  fit() {
    if (this.terminal.element?.isConnected) this.#fit.fit();
  }

  focus() {
    this.terminal.focus();
  }

  openFind() {
    this.#findOpen = true;
    this.#signal.publish();
  }

  closeFind() {
    this.#findOpen = false;
    this.#results = null;
    this.#search.clearDecorations();
    this.#signal.publish();
    this.focus();
  }

  find(query: string, options: SearchOptions, previous = false) {
    if (!query) {
      this.#search.clearDecorations();
      this.#results = null;
      this.#signal.publish();
      return false;
    }
    const search = { ...options, decorations: FIND_DECORATIONS };
    return previous ? this.#search.findPrevious(query, search) : this.#search.findNext(query, search);
  }

  get background() {
    return this.terminal.options.theme?.background ?? null;
  }

  updateLook(appearance: TerminalAppearance, scheme: ColorScheme) {
    if (scheme === this.#scheme && JSON.stringify(appearance) === JSON.stringify(this.#appearance)) return;
    this.#appearance = appearance;
    this.#scheme = scheme;
    const { theme, fontFamily, fontSize, cursorStyle, cursorBlink, macOptionIsMeta } = this.#resolveOptions();
    Object.assign(this.terminal.options, {
      theme,
      fontFamily,
      fontSize,
      cursorStyle,
      cursorBlink,
      macOptionIsMeta,
    });
    this.#sendColors();
    this.fit();
    this.#signal.publish();
  }

  dispose() {
    this.#disposed = true;
    this.unmount();
    this.#socket?.close();
    this.terminal.dispose();
  }
}

const views = new Map<string, TerminalView>();

export function resolveTerminalView(options: TerminalViewOptions) {
  const existing = views.get(options.id);
  if (existing) return existing;
  const view = new TerminalView(options);
  views.set(options.id, view);
  return view;
}

export function syncTerminalViews(ids: ReadonlySet<string>) {
  for (const [id, view] of views) {
    if (ids.has(id)) continue;
    view.dispose();
    views.delete(id);
  }
}

export function selectTerminalView(id: string) {
  return views.get(id) ?? null;
}
