import { describe, expect, it } from 'bun:test';
import { isAppPath, respondApp } from '../../src/worker/app.ts';

describe('the remote dashboard under shinsa.dev/app', () => {
  it('takes /app and everything under it, and nothing else', () => {
    expect(isAppPath('/app')).toBe(true);
    expect(isAppPath('/app/')).toBe(true);
    expect(isAppPath('/app/__remote/session')).toBe(true);
    expect(isAppPath('/application')).toBe(false);
    expect(isAppPath('/download')).toBe(false);
    expect(isAppPath('/')).toBe(false);
  });

  it('hands the request to the remote Worker as it came', async () => {
    const seen: string[] = [];
    const answer = await respondApp(new Request('https://shinsa.dev/app/pair?code=K7PQ'), {
      fetch: (request) => {
        seen.push(request.url);
        return Promise.resolve(new Response('dashboard'));
      },
    });
    expect(await answer.text()).toBe('dashboard');
    expect(seen).toEqual(['https://shinsa.dev/app/pair?code=K7PQ']);
  });

  it('sends www to shinsa.dev, so the session and the Mac only ever see one origin', async () => {
    const answer = await respondApp(new Request('https://www.shinsa.dev/app/x?y=1'), null);
    expect(answer.status).toBe(308);
    expect(answer.headers.get('location')).toBe('https://shinsa.dev/app/x?y=1');
  });

  it('says so when the remote Worker is not bound', async () => {
    expect((await respondApp(new Request('https://shinsa.dev/app/'), null)).status).toBe(503);
  });
});
