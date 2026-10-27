import type { AccountLogin } from '@shinsa/core';
import { describeError, log } from '../log/index.ts';
import type { Env } from './paths.ts';

export interface LoginProcess {
  write: (data: string) => void;
  kill: () => void;
  exited: Promise<number>;
}

export interface LoginSpawnOptions {
  cwd: string;
  env: Env;
  onData: (text: string) => void;
}

export type LoginSpawner = (command: string[], options: LoginSpawnOptions) => LoginProcess;

export type LoginFinisher = (
  accountId: string,
  loginId: string
) => Promise<{ ok: true; email: string | null } | { ok: false; message: string }>;

export interface LoginTimers {
  menuFallbackMs: number;
  urlTimeoutMs: number;
  watchdogMs: number;
}

export interface AccountLoginsOptions {
  spawn: LoginSpawner;
  finish: LoginFinisher;
  onChange: () => void;
  onEnded?: (login: AccountLogin) => void;
  now?: () => number;
  newId?: () => string;
  timers?: Partial<LoginTimers>;
}

export interface LoginStart {
  accountId: string;
  claude: string;
  cwd: string;
  env: Env;
  email: string | null;
}

const TIMERS: LoginTimers = { menuFallbackMs: 5_000, urlTimeoutMs: 30_000, watchdogMs: 16 * 60_000 };

const TRANSCRIPT_LIMIT = 16_384;

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal links start with an escape character
const OSC_LINK = /\u001b]8;[^;]*;([^\u0007\u001b]*)(?:\u0007|\u001b\\)/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal escape sequences start with an escape character
const ESCAPES = /\u001b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\u0007\u001b]*(?:\u0007|\u001b\\)|[@-Z\\-_])/g;

const URL_PATTERN = /https:\/\/[^\s"'<>]+/g;

const KEYCHAIN_HINT =
  'On a Mac the keychain may need your approval the first time. Run `claude auth login` in a terminal once, then try again.';

function isSignInUrl(url: string) {
  return url.includes('oauth') && url.includes('authorize');
}

export function parseLoginUrl(transcript: string) {
  const linked = [...transcript.matchAll(OSC_LINK)].map((match) => match[1] ?? '');
  const visible = transcript.replace(ESCAPES, '').match(URL_PATTERN) ?? [];
  return [...linked, ...visible].find(isSignInUrl) ?? null;
}

function describeTail(transcript: string) {
  const lines = transcript
    .replace(ESCAPES, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return lines.at(-1) ?? 'it printed nothing';
}

interface Flow {
  login: AccountLogin;
  process: LoginProcess | null;
  transcript: string;
  codeSent: boolean;
  timers: ReturnType<typeof setTimeout>[];
}

export class AccountLogins {
  readonly #options: AccountLoginsOptions;
  readonly #timers: LoginTimers;
  #flow: Flow | null = null;

  constructor(options: AccountLoginsOptions) {
    this.#options = options;
    this.#timers = { ...TIMERS, ...options.timers };
  }

  current(): AccountLogin | null {
    return this.#flow ? { ...this.#flow.login } : null;
  }

  #update(flow: Flow, patch: Partial<AccountLogin>) {
    if (this.#flow !== flow) return;
    flow.login = { ...flow.login, ...patch };
    this.#options.onChange();
  }

  #end(flow: Flow, patch: Partial<AccountLogin>) {
    if (this.#flow !== flow || flow.login.phase === 'done' || flow.login.phase === 'failed') return;
    for (const timer of flow.timers) clearTimeout(timer);
    flow.process?.kill();
    this.#update(flow, patch);
    this.#options.onEnded?.(flow.login);
  }

  start(start: LoginStart): AccountLogin {
    const previous = this.#flow;
    if (previous) this.#end(previous, { phase: 'failed', message: 'Another sign-in started.' });
    const flow: Flow = {
      login: {
        id: (this.#options.newId ?? (() => crypto.randomUUID()))(),
        accountId: start.accountId,
        email: start.email,
        phase: 'starting',
        url: null,
        message: null,
        startedAt: (this.#options.now ?? Date.now)(),
      },
      process: null,
      transcript: '',
      codeSent: false,
      timers: [],
    };
    this.#flow = flow;
    this.#options.onChange();
    try {
      flow.process = this.#options.spawn([start.claude, 'auth', 'login', '--claudeai'], {
        cwd: start.cwd,
        env: start.env,
        onData: (text) => this.#read(flow, text),
      });
    } catch (error) {
      this.#end(flow, {
        phase: 'failed',
        message: `Claude could not start the sign-in: ${describeError(error)}`,
      });
      return this.current() as AccountLogin;
    }
    this.#watch(flow, flow.process);
    return this.current() as AccountLogin;
  }

  #watch(flow: Flow, process: LoginProcess) {
    flow.timers.push(
      setTimeout(() => {
        if (flow.login.phase === 'starting') process.write('\r');
      }, this.#timers.menuFallbackMs),
      setTimeout(() => {
        if (flow.login.phase !== 'starting') return;
        this.#end(flow, {
          phase: 'failed',
          message: `Claude did not show a sign-in link (${describeTail(flow.transcript)}). ${KEYCHAIN_HINT}`,
        });
      }, this.#timers.urlTimeoutMs),
      setTimeout(() => {
        this.#end(flow, { phase: 'failed', message: 'The sign-in took too long, so Shinsa stopped it.' });
      }, this.#timers.watchdogMs)
    );
    process.exited.then(
      (code) => this.#exited(flow, code),
      (error: unknown) => this.#end(flow, { phase: 'failed', message: describeError(error) })
    );
  }

  #read(flow: Flow, text: string) {
    flow.transcript = (flow.transcript + text).slice(-TRANSCRIPT_LIMIT);
    if (flow.login.phase !== 'starting') return;
    const url = parseLoginUrl(flow.transcript);
    if (url) this.#update(flow, { phase: 'waiting', url });
  }

  async #exited(flow: Flow, code: number) {
    if (this.#flow !== flow || flow.login.phase === 'done' || flow.login.phase === 'failed') return;
    if (code !== 0 && !flow.codeSent) {
      this.#end(flow, {
        phase: 'failed',
        message: `Claude ended the sign-in (${describeTail(flow.transcript)}).`,
      });
      return;
    }
    this.#update(flow, { phase: 'finishing' });
    const outcome = await this.#finish(flow.login.accountId, flow.login.id);
    if (outcome.ok)
      this.#end(flow, { phase: 'done', email: outcome.email ?? flow.login.email, message: null });
    else this.#end(flow, { phase: 'failed', message: outcome.message });
  }

  async #finish(accountId: string, loginId: string) {
    try {
      return await this.#options.finish(accountId, loginId);
    } catch (error) {
      log.warn('[Accounts] Could not check the account after signing in', {
        accountId,
        error: describeError(error),
      });
      return { ok: false as const, message: `Shinsa could not check the sign-in: ${describeError(error)}` };
    }
  }

  #select(loginId: string) {
    const flow = this.#flow;
    return flow && flow.login.id === loginId ? flow : null;
  }

  submitCode(loginId: string, code: string) {
    const flow = this.#select(loginId);
    if (!flow?.process || flow.login.phase !== 'waiting') return false;
    flow.codeSent = true;
    flow.process.write(`${code.trim()}\r`);
    this.#update(flow, { phase: 'finishing' });
    return true;
  }

  cancel(loginId: string) {
    const flow = this.#select(loginId);
    if (!flow) return false;
    this.#end(flow, { phase: 'failed', message: 'You cancelled the sign-in.' });
    return true;
  }

  clear(loginId: string) {
    const flow = this.#select(loginId);
    if (!flow || (flow.login.phase !== 'done' && flow.login.phase !== 'failed')) return;
    this.#flow = null;
    this.#options.onChange();
  }

  stop() {
    if (this.#flow) this.#end(this.#flow, { phase: 'failed', message: 'Shinsa stopped.' });
  }
}

export function spawnLoginTerminal(command: string[], options: LoginSpawnOptions): LoginProcess {
  const decoder = new TextDecoder();
  const child = Bun.spawn(command, {
    cwd: options.cwd,
    env: { ...Bun.env, ...options.env, TERM: 'xterm-256color' },
    terminal: {
      cols: 200,
      rows: 50,
      name: 'xterm-256color',
      data: (_terminal, data) => options.onData(decoder.decode(data, { stream: true })),
    },
  });
  return {
    write: (data) => {
      child.terminal?.write(data);
    },
    kill: () => {
      child.kill();
    },
    exited: child.exited,
  };
}
