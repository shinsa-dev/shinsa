import {
  type MachineCredentials,
  PAIRING_SEAL_IV_BYTES,
  REMOTE_KEY_ALGORITHM,
  REMOTE_PATHS,
  sealPairingCredentials,
} from '@shinsa/core';
import { Effect } from 'effect';

interface ControlCall {
  path: string;
  token: string | null;
  body: unknown;
}

export interface FakeControlPlane {
  origin: string;
  calls: ControlCall[];
  answers: Map<string, () => Response | Promise<Response>>;
  stop: () => Promise<void>;
}

export async function sealCredentials(machineKey: string, credentials: MachineCredentials) {
  const ephemeral = (await crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, [
    'deriveBits',
  ])) as CryptoKeyPair;
  const iv = crypto.getRandomValues(new Uint8Array(PAIRING_SEAL_IV_BYTES));
  return Effect.runPromise(sealPairingCredentials({ machineKey, ephemeral, iv }, credentials));
}

export function refuse(failure: { readonly code: string; readonly status: number }, message = 'Refused.') {
  return Response.json({ error: { code: failure.code, message } }, { status: failure.status });
}

export function startFakeControlPlane(): FakeControlPlane {
  const calls: ControlCall[] = [];
  const answers = new Map<string, () => Response | Promise<Response>>();
  const server = Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const authorization = request.headers.get('authorization');
      const text = await request.text();
      calls.push({
        path,
        token: authorization?.replace(/^Bearer /, '') ?? null,
        body: text ? JSON.parse(text) : null,
      });
      const answer = answers.get(path);
      if (answer) return answer();
      if (path === REMOTE_PATHS.pairStart)
        return Response.json({ claimCode: 'c', pollSecret: 's', url: 'u', expiresAt: 1 });
      if (path === REMOTE_PATHS.pairPoll) return Response.json({ status: 'pending' });
      if (path === REMOTE_PATHS.machineInvites) return Response.json({ token: 'invite-token' });
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
