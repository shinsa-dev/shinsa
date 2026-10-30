import { REMOTE_PATHS } from '@shinsa/core';

export interface ControlCall {
  path: string;
  token: string | null;
  body: unknown;
}

export interface FakeControlPlane {
  origin: string;
  calls: ControlCall[];
  answers: Map<string, () => Response>;
  stop: () => Promise<void>;
}

export function startFakeControlPlane(): FakeControlPlane {
  const calls: ControlCall[] = [];
  const answers = new Map<string, () => Response>();
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const authorization = request.headers.get('authorization');
      calls.push({ path, token: authorization?.replace(/^Bearer /, '') ?? null, body: await request.json() });
      const answer = answers.get(path);
      if (answer) return answer();
      if (path === REMOTE_PATHS.pairStart)
        return Response.json({ claimCode: 'c', pollSecret: 's', url: 'u', expiresAt: 1 });
      if (path === REMOTE_PATHS.pairPoll) return Response.json({ status: 'pending' });
      return Response.json({ ok: true });
    },
  });
  return {
    origin: `http://127.0.0.1:${server.port}`,
    calls,
    answers,
    stop: () => server.stop(true),
  };
}
