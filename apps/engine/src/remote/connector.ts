import type { TunnelConnector } from './supervisor.ts';

const CONNECTED_PATTERN = /Registered tunnel connection/;

const CONNECT_TIMEOUT_MS = 30_000;

const OUTPUT_TAIL_CHARS = 2_000;

export interface CloudflaredConnectorOptions {
  binary: () => Promise<string>;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
}

async function watchOutput(
  stream: ReadableStream<Uint8Array>,
  onLine: (text: string) => void
): Promise<void> {
  const decoder = new TextDecoder();
  for await (const chunk of stream) onLine(decoder.decode(chunk, { stream: true }));
}

export function createCloudflaredConnector(options: CloudflaredConnectorOptions) {
  return async (tunnelToken: string, localUrl: string): Promise<TunnelConnector> => {
    const binary = await options.binary();
    const child = Bun.spawn([binary, 'tunnel', '--no-autoupdate', 'run', '--url', localUrl], {
      env: { ...(options.env ?? process.env), TUNNEL_TOKEN: tunnelToken },
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'pipe',
    });
    const stop = () => child.kill();
    let tail = '';
    const connected = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        stop();
        reject(new Error('cloudflared did not connect within 30 seconds.'));
      }, options.timeoutMs ?? CONNECT_TIMEOUT_MS);
      void watchOutput(child.stderr, (text) => {
        tail = `${tail}${text}`.slice(-OUTPUT_TAIL_CHARS);
        if (!CONNECTED_PATTERN.test(tail)) return;
        clearTimeout(timer);
        resolve();
      });
      void child.exited.then((code) => {
        clearTimeout(timer);
        reject(new Error(`cloudflared stopped with code ${code}: ${tail.trim().split('\n').at(-1) ?? ''}`));
      });
    });
    await connected;
    return { exited: child.exited, stop };
  };
}
