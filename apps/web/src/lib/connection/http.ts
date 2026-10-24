async function readBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function describeRefusal(body: unknown, code: number) {
  const message = (body as { error?: { message?: unknown } } | null)?.error?.message;
  return typeof message === 'string' ? message : `Shinsa answered with status ${code}.`;
}

async function send(path: string, body: unknown) {
  try {
    if (body === undefined) return await fetch(path);
    return await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error('Couldn’t reach Shinsa.');
  }
}

export async function requestJson<T>(path: string, body?: unknown): Promise<T> {
  const response = await send(path, body);
  const answer = await readBody(response);
  if (!response.ok || answer === null) throw new Error(describeRefusal(answer, response.status));
  return answer as T;
}

export async function requestText(path: string): Promise<string> {
  const response = await send(path, undefined);
  if (!response.ok) throw new Error(describeRefusal(await readBody(response), response.status));
  return response.text();
}
