import {
  SLACK_RELAY_PATHS,
  type SlackLinks,
  type SlackRelayPost,
  type SlackRelayPosted,
  type SlackRelayReacted,
  type SlackRelayReaction,
  type SlackRelaySession,
  type SlackRelaySessionSet,
} from '@shinsa/core';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

const RELAY_TIMEOUT_MS = 15_000;

export class SlackRelayError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'SlackRelayError';
    this.status = status;
    this.code = code;
  }

  get isRetryable() {
    return this.status === 0 || this.status === 429 || this.status >= 500;
  }
}

async function readRefusal(response: Response) {
  try {
    const body = (await response.json()) as { error?: { code?: unknown; message?: unknown } };
    const code = typeof body.error?.code === 'string' ? body.error.code : 'relay_failed';
    const message = typeof body.error?.message === 'string' ? body.error.message : null;
    return { code, message };
  } catch {
    return { code: 'relay_failed', message: null };
  }
}

export class SlackRelay {
  readonly #origin: () => string;
  readonly #fetch: Fetch;

  constructor(origin: () => string, fetch: Fetch = (input, init) => globalThis.fetch(input, init)) {
    this.#origin = origin;
    this.#fetch = fetch;
  }

  async #call<T>(path: string, token: string, body: unknown): Promise<T> {
    let response: Response;
    try {
      response = await this.#fetch(`${this.#origin()}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(RELAY_TIMEOUT_MS),
      });
    } catch {
      throw new SlackRelayError(0, 'unreachable', 'app.shinsa.dev could not be reached.');
    }
    if (!response.ok) {
      const refusal = await readRefusal(response);
      throw new SlackRelayError(
        response.status,
        refusal.code,
        refusal.message ?? `app.shinsa.dev answered ${path} with status ${response.status}.`
      );
    }
    return (await response.json()) as T;
  }

  async requestPost(token: string, post: SlackRelayPost) {
    const posted = await this.#call<SlackRelayPosted>(SLACK_RELAY_PATHS.post, token, post);
    return posted.ts;
  }

  async requestSession(token: string, session: SlackRelaySession) {
    const set = await this.#call<SlackRelaySessionSet>(SLACK_RELAY_PATHS.session, token, session);
    return set.applied;
  }

  async requestReaction(token: string, reaction: SlackRelayReaction) {
    const reacted = await this.#call<SlackRelayReacted>(SLACK_RELAY_PATHS.react, token, reaction);
    return reacted.applied;
  }

  async requestLinks(token: string) {
    const answer = await this.#call<SlackLinks>(SLACK_RELAY_PATHS.links, token, undefined);
    return answer.links;
  }

  async requestUnlink(token: string) {
    await this.#call<unknown>(SLACK_RELAY_PATHS.unlink, token, {});
  }
}
