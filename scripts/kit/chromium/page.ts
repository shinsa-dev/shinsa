import { type Evaluated, HOVER_MS, type Key, type Message, type Pending, type Point } from './schema.ts';

export class CdpPage {
  #socket: WebSocket;
  #id = 0;
  #pending = new Map<number, Pending>();
  #listeners = new Map<string, Set<(params: unknown) => void>>();

  private constructor(socket: WebSocket) {
    this.#socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as Message;
      if (message.id === undefined) {
        for (const listener of this.#listeners.get(message.method ?? '') ?? []) listener(message.params);
        return;
      }
      const pending = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (message.error) pending?.reject(new Error(message.error.message));
      else pending?.resolve(message.result);
    });
  }

  static async open(url: string) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true });
      socket.addEventListener('error', reject, { once: true });
    });
    return new CdpPage(socket);
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}) {
    const id = ++this.#id;
    this.#socket.send(JSON.stringify({ id, method, params }));
    return new Promise<T>((resolve, reject) => {
      this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
    });
  }

  on<T>(method: string, listener: (params: T) => void) {
    const listeners = this.#listeners.get(method) ?? new Set();
    const wrapped = listener as (params: unknown) => void;
    listeners.add(wrapped);
    this.#listeners.set(method, listeners);
    return () => listeners.delete(wrapped);
  }

  listen(listener: (event: MessageEvent) => void) {
    this.#socket.addEventListener('message', listener);
  }

  async evaluate<T>(expression: string): Promise<T> {
    const reply = await this.send<Evaluated<T>>('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (reply.exceptionDetails)
      throw new Error(
        reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text ?? 'evaluate failed'
      );
    return reply.result.value;
  }

  async pressKey(key: Key) {
    const base = {
      key: key.key,
      code: key.code,
      windowsVirtualKeyCode: key.keyCode,
      modifiers: key.modifiers ?? 0,
    };
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  }

  async clickPoint(point: Point, hoverMs = HOVER_MS) {
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await Bun.sleep(hoverMs);
    for (const type of ['mousePressed', 'mouseReleased'])
      await this.send('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
  }

  close() {
    this.#socket.close();
  }
}
