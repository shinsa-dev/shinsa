import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { lintHtml, listHtmlRules, resolveHtmlReport, runHtmlLint, serializeHtmlAsJsx } from './lint-html.ts';

const OXLINT = join(process.cwd(), 'node_modules/.bin/oxlint');

const folders: string[] = [];

afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true, force: true });
});

function writeHtml(html: string) {
  const folder = mkdtempSync(join(process.cwd(), '.lint-html-'));
  folders.push(folder);
  const file = join(folder, 'page.html');
  writeFileSync(file, html);
  return relative(process.cwd(), file);
}

describe('the HTML lint', () => {
  test('a page becomes JSX on the same lines, with React attribute names', () => {
    const html = [
      '<!doctype html>',
      '<!-- a note -->',
      '<html lang="en" class="dark">',
      '<img src=a.png alt="A cat"><br></br>',
      '<input tabindex="0" autofocus autocomplete="off" accesskey="s"><label for="x">X</label>',
      '<p onclick="go()" onmouseover="hover()">a { b } > c</p>',
      '<script>if (a > b) { run(); }\n</script>',
      '<style>.a { color: red; }</style>',
      '<hr/>',
      '</html>',
    ].join('\n');
    const jsx = serializeHtmlAsJsx(html);
    const lines = jsx.split('\n');
    expect(lines).toHaveLength(html.split('\n').length + 1);
    expect(lines[0]).toBe(`export default (<>${' '.repeat(15)}`);
    expect(lines[1]?.trim()).toBe('');
    expect(lines[2]).toBe('<html lang="en" className="dark">');
    expect(lines[3]).toBe('<img src="a.png" alt="A cat"/><br/>     ');
    expect(lines[4]).toBe(
      '<input tabIndex="0" autoFocus autoComplete="off" accessKey="s"/><label htmlFor="x">X</label>'
    );
    expect(lines[5]).toBe('<p onClick="go()" onMouseOver="hover()">a &#123; b &#125; &gt; c</p>');
    expect(lines[6]?.trim()).toBe('<script>');
    expect(lines[7]).toBe('</script>');
    expect(lines[8]).toBe(`<style>${' '.repeat(18)}</style>`);
    expect(lines[9]).toBe('<hr/>');
    expect(lines[10]).toBe('</html></>);');
  });

  test('only the rules that read markup are run on HTML', () => {
    const rules = listHtmlRules({
      rules: {
        'jsx-a11y/alt-text': 'error',
        'react/button-has-type': 'error',
        'react/jsx-no-duplicate-props': 'error',
        'shinsa/use-semantic-elements': 'error',
        'react/rules-of-hooks': 'error',
        'eslint/no-console': 'error',
      },
    });
    expect(Object.keys(rules)).toEqual([
      'jsx-a11y/alt-text',
      'react/button-has-type',
      'react/jsx-no-duplicate-props',
      'shinsa/use-semantic-elements',
    ]);
  });

  test('a report names the HTML file, not the JSX it was read as', () => {
    expect(resolveHtmlReport('/tmp/x/apps/web/index.html.tsx:3:1 error', '/tmp/x')).toBe(
      'apps/web/index.html:3:1 error'
    );
  });

  test('a page with the faults Biome caught fails, on their lines', () => {
    const file = writeHtml(
      [
        '<!doctype html>',
        '<html>',
        '<body>',
        '<img src="a.png">',
        '<div class="a" class="b"></div>',
        '<button>Go</button>',
        '</body>',
        '</html>',
      ].join('\n')
    );
    const { ok, output } = runHtmlLint([file], OXLINT);
    expect(ok).toBe(false);
    expect(output).toContain(`${file}:2:`);
    expect(output).toContain('html-has-lang');
    expect(output).toContain(`${file}:4:`);
    expect(output).toContain('alt-text');
    expect(output).toContain('jsx-no-duplicate-props');
    expect(output).toContain('button-has-type');
    expect(output).not.toContain('.html.tsx');
  });

  test('a sound page passes', () => {
    const file = writeHtml(
      '<!doctype html>\n<html lang="en"><body><button type="button">Go</button></body></html>\n'
    );
    expect(runHtmlLint([file], OXLINT).ok).toBe(true);
  });

  test('every HTML file in the repository passes', () => {
    const write = spyOn(process.stdout, 'write').mockImplementation(() => true);
    expect(lintHtml()).toBe(0);
    write.mockRestore();
  });
});
