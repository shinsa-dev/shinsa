import { describe, expect, test } from 'bun:test';
import { SANDBOX_PATH, serializeSandboxPage } from './sandbox-page.ts';

const STYLESHEET = '/assets/main-abc.css';

describe('serializeSandboxPage', () => {
  test('lists every link under its section with its address', () => {
    const page = serializeSandboxPage(
      [
        {
          title: 'The remote dashboard',
          links: [{ label: 'The merged dashboard', url: 'http://127.0.0.1:5195/app' }],
        },
        {
          title: 'Pairing',
          links: [{ label: 'Approve a pairing', url: 'http://127.0.0.1:5195/pair?code=K7PQ' }],
        },
      ],
      STYLESHEET
    );
    expect(page).toContain('>The remote dashboard</h2>');
    expect(page).toContain(
      'href="http://127.0.0.1:5195/app"><span class="truncate text-fg-4 text-xs">The merged dashboard</span>'
    );
    expect(page).toContain('>http://127.0.0.1:5195/pair?code=K7PQ</code>');
    expect(page.indexOf('The remote dashboard')).toBeLessThan(page.indexOf('Pairing'));
  });

  test('styles itself with the web app’s stylesheet and theme', () => {
    const page = serializeSandboxPage([], STYLESHEET);
    expect(page).toContain(`<link rel="stylesheet" href="${STYLESHEET}">`);
    expect(page).toContain("'dark' : 'light'");
    expect(page).toContain('<html lang="en" class="font-sans antialiased">');
  });

  test('escapes labels and addresses', () => {
    const page = serializeSandboxPage(
      [{ title: 'Mona’s <tasks>', links: [{ label: '"Quoted" & more', url: 'http://x/?a=1&b=<2>' }] }],
      STYLESHEET
    );
    expect(page).toContain('>Mona’s &lt;tasks&gt;</h2>');
    expect(page).toContain('href="http://x/?a=1&amp;b=&lt;2&gt;"');
    expect(page).toContain('&quot;Quoted&quot; &amp; more');
    expect(page).not.toContain('<tasks>');
  });

  test('leaves out a section with no links', () => {
    const page = serializeSandboxPage([{ title: 'Nothing here', links: [] }], STYLESHEET);
    expect(page).not.toContain('Nothing here');
    expect(page).toContain('>Shinsa sandbox</h1>');
  });

  test('lives under its own path', () => {
    expect(SANDBOX_PATH).toBe('/sandbox');
  });
});
