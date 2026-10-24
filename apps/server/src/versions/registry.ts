const REGISTRY_TIMEOUT_MS = 10_000;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export async function requestLatestVersion(name: string, fetchFn: FetchLike = fetch) {
  const response = await fetchFn(`https://registry.npmjs.org/${name}/latest`, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The npm registry answered ${response.status} for ${name}.`);
  const body = (await response.json()) as { version?: unknown } | null;
  if (typeof body?.version !== 'string') throw new Error(`The npm registry gave no version for ${name}.`);
  return body.version;
}
