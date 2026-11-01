import { describe, expect, it } from 'bun:test';
import { serializeSandboxPage } from '@/components/sandbox/sandbox-page.tsx';

const STYLESHEET = '/assets/main-abc.css';

describe('serializeSandboxPage', () => {
  it('lists every link under its section in a kit card, with its address', () => {
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
    expect(page).toContain('data-slot="card"');
    expect(page).toContain('href="http://127.0.0.1:5195/app"');
    expect(page).toContain('>The merged dashboard</span>');
    expect(page).toContain('>http://127.0.0.1:5195/pair?code=K7PQ</code>');
    expect(page.indexOf('The remote dashboard')).toBeLessThan(page.indexOf('Pairing'));
  });

  it('styles itself with the web app’s stylesheet and theme', () => {
    const page = serializeSandboxPage([], STYLESHEET);
    expect(page.startsWith('<!doctype html><html lang="en" class="font-sans antialiased">')).toBe(true);
    expect(page).toContain(`<link rel="stylesheet" href="${STYLESHEET}"/>`);
    expect(page).toContain(
      "<script>document.documentElement.classList.add(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')</script>"
    );
  });

  it('escapes labels and addresses', () => {
    const page = serializeSandboxPage(
      [{ title: 'Mona’s <tasks>', links: [{ label: '"Quoted" & more', url: 'http://x/?a=1&b=<2>' }] }],
      STYLESHEET
    );
    expect(page).toContain('>Mona’s &lt;tasks&gt;</h2>');
    expect(page).toContain('href="http://x/?a=1&amp;b=&lt;2&gt;"');
    expect(page).not.toContain('<tasks>');
  });

  it('leaves out a section with no links', () => {
    const page = serializeSandboxPage([{ title: 'Nothing here', links: [] }], STYLESHEET);
    expect(page).not.toContain('Nothing here');
    expect(page).toContain('>Shinsa sandbox</h1>');
  });
});
