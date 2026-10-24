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

async function send(path: string, body: unknown, accept?: string) {
  try {
    if (body === undefined) return await fetch(path);
    return await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(accept ? { accept } : {}) },
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

export async function requestLines<T>(path: string, body: unknown, onLine: (line: T) => void) {
  const response = await send(path, body, 'application/x-ndjson');
  if (!response.ok || !response.body)
    throw new Error(describeRefusal(await readBody(response), response.status));
  const decoder = new TextDecoder();
  let pending = '';
  const take = (text: string) => {
    const lines = `${pending}${text}`.split('\n');
    pending = lines.pop() ?? '';
    for (const line of lines) if (line.trim()) onLine(JSON.parse(line) as T);
  };
  try {
    for await (const chunk of response.body) take(decoder.decode(chunk, { stream: true }));
  } catch {
    throw new Error('Shinsa stopped answering.');
  }
  take(`${decoder.decode()}\n`);
}
