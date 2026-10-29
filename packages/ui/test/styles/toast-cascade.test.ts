import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/*
 * Sonner injects its stylesheet at runtime (`__insertCSS` appends a <style> to <head>), so in a
 * production build it lands after our stylesheet's <link>, and in the dev server before Vite's
 * injected styles. Order is not ours to rely on: every unlayered toast rule in globals.css has to
 * be strictly more specific than each sonner rule that sets one of the same properties on the same
 * part, or the production app shows sonner's values while the dev server shows ours.
 */

type Specificity = [number, number, number];
type Rule = { selector: string; properties: string[] };

const sonnerSource = readFileSync(fileURLToPath(import.meta.resolve('sonner')), 'utf8');
const injected = /__insertCSS\(("(?:[^"\\]|\\.)*")\)/.exec(sonnerSource)?.[1];
const sonnerCss: string = injected ? JSON.parse(injected) : '';
const ourCss = readFileSync(new URL('../../src/styles/globals.css', import.meta.url), 'utf8');

/** Sonner states Shinsa never turns on, so their rules never reach a Shinsa toast. */
const NEVER_ON = ['[data-rich-colors=true]', '[data-invert=true]'];

const SHORTHANDS: Record<string, string[]> = {
  margin: ['margin-top', 'margin-right', 'margin-bottom', 'margin-left'],
  'margin-inline': ['margin-left', 'margin-right'],
  padding: ['padding-top', 'padding-right', 'padding-bottom', 'padding-left'],
  gap: ['row-gap', 'column-gap'],
  border: ['border-width', 'border-style', 'border-color'],
  background: ['background-color', 'background-image'],
  flex: ['flex-grow', 'flex-shrink', 'flex-basis'],
};

function longhands(property: string) {
  return SHORTHANDS[property] ?? [property];
}

/** Splits `text` at `separator` where it is not inside brackets, parentheses or quotes. */
function splitTopLevel(text: string, separator: string) {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '(' || char === '[') depth++;
    else if (char === ')' || char === ']') depth--;
    else if (depth === 0 && char === separator) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter(Boolean);
}

function closingBrace(css: string, open: number) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return i;
  }
  return css.length;
}

/** The unlayered style rules of a stylesheet, `@media` and `@supports` bodies included. */
function parseRules(source: string): Rule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = [];
  let cursor = 0;
  while (cursor < css.length) {
    const open = css.indexOf('{', cursor);
    const semicolon = css.indexOf(';', cursor);
    if (open === -1) break;
    if (semicolon !== -1 && semicolon < open) {
      cursor = semicolon + 1;
      continue;
    }
    const prelude = css.slice(cursor, open).trim();
    const close = closingBrace(css, open);
    const body = css.slice(open + 1, close);
    if (/^@(media|supports)\b/.test(prelude)) rules.push(...parseRules(body));
    else if (!prelude.startsWith('@')) {
      const flat = body.replace(/[^{};]*\{[^{}]*\}/g, '');
      const properties = splitTopLevel(flat, ';').flatMap((declaration) =>
        longhands(declaration.slice(0, declaration.indexOf(':')).trim())
      );
      for (const selector of splitTopLevel(prelude, ',')) rules.push({ selector, properties });
    }
    cursor = close + 1;
  }
  return rules;
}

function add(a: Specificity, b: Specificity): Specificity {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function compare(a: Specificity, b: Specificity) {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

function specificity(selector: string): Specificity {
  let total: Specificity = [0, 0, 0];
  let i = 0;
  const ident = () => {
    const match = /^[\w-]+/.exec(selector.slice(i));
    i += match?.[0].length ?? 0;
    return match?.[0] ?? '';
  };
  while (i < selector.length) {
    const char = selector[i];
    if (char === '#') {
      i++;
      ident();
      total = add(total, [1, 0, 0]);
    } else if (char === '.') {
      i++;
      ident();
      total = add(total, [0, 1, 0]);
    } else if (char === '[') {
      i = selector.indexOf(']', i) + 1;
      total = add(total, [0, 1, 0]);
    } else if (selector.startsWith('::', i)) {
      i += 2;
      ident();
      total = add(total, [0, 0, 1]);
    } else if (char === ':') {
      i++;
      const name = ident();
      let argument = '';
      if (selector[i] === '(') {
        let depth = 0;
        const start = i + 1;
        for (; i < selector.length; i++) {
          if (selector[i] === '(') depth++;
          else if (selector[i] === ')' && --depth === 0) break;
        }
        argument = selector.slice(start, i);
        i++;
      }
      if (name === 'where') continue;
      if (['is', 'not', 'has'].includes(name)) {
        const most = splitTopLevel(argument, ',')
          .map(specificity)
          .sort((a, b) => compare(b, a))[0];
        total = add(total, most ?? [0, 0, 0]);
      } else total = add(total, [0, 1, 0]);
    } else if (/[a-zA-Z]/.test(char ?? '')) {
      ident();
      total = add(total, [0, 0, 1]);
    } else i++;
  }
  return total;
}

/** The compounds of a selector, outermost first, with pseudo-class arguments left inside. */
function compounds(selector: string) {
  return splitTopLevel(selector.replace(/\s*([>+~])\s*/g, ' '), ' ');
}

/** What a compound names, ignoring states: its type, bare attributes and non-Shinsa classes. */
function compoundKey(compound: string) {
  const bare = compound.replace(/:[\w-]+(\((?:[^()]|\([^()]*\))*\))?/g, '');
  const parts = bare.match(/^[a-zA-Z*][\w-]*|\[[\w-]+\]|\.(?!bk-)[\w-]+/g) ?? [];
  return parts.join('');
}

/** The part a rule styles: its last compound, and for a bare element the part it sits in. */
function partOf(selector: string) {
  const all = compounds(selector).map(compoundKey);
  const last = all.at(-1) ?? '';
  return /^[a-zA-Z*][\w-]*$/.test(last) ? `${all.at(-2)} ${last}` : last;
}

function samePart(ours: string, theirs: string) {
  return ours === theirs || (theirs.endsWith(' *') && ours.startsWith(theirs.slice(0, -1)));
}

const sonnerRules = parseRules(sonnerCss).filter(
  (rule) => !NEVER_ON.some((state) => rule.selector.includes(state))
);
const toastRules = parseRules(ourCss).filter((rule) => rule.selector.includes('.bk-toast'));

describe('toast styles against sonner’s injected stylesheet', () => {
  it('reads sonner’s stylesheet and our toast rules', () => {
    expect(sonnerCss).toContain('[data-sonner-toast][data-styled=true] [data-icon]{');
    expect(sonnerRules.length).toBeGreaterThan(50);
    expect(toastRules.length).toBeGreaterThan(10);
  });

  it('scores selectors the way the cascade does', () => {
    expect(specificity('[data-sonner-toast][data-styled=true] [data-icon]')).toEqual([0, 3, 0]);
    expect(specificity('[data-sonner-toast].bk-toast:has([data-description]) [data-icon]')).toEqual([
      0, 4, 0,
    ]);
    expect(specificity('#a > b::before:hover:where(.c)')).toEqual([1, 1, 2]);
    expect(specificity(':is(.a, #b) svg')).toEqual([1, 0, 1]);
    expect(partOf('[data-sonner-toast][data-styled="true"].bk-toast [data-icon] > svg')).toBe(
      '[data-icon] svg'
    );
    expect(partOf('[data-sonner-toast].bk-toast .sonner-loader[data-visible="false"]')).toBe(
      '.sonner-loader'
    );
    expect(samePart('[data-icon] svg', '[data-icon] *')).toBe(true);
  });

  it('beats every sonner rule it overrides on specificity alone, so stylesheet order never decides', () => {
    const losing: string[] = [];
    for (const ours of toastRules) {
      const part = partOf(ours.selector);
      for (const theirs of sonnerRules) {
        if (!samePart(part, partOf(theirs.selector))) continue;
        const shared = ours.properties.filter((property) => theirs.properties.includes(property));
        if (shared.length === 0) continue;
        if (compare(specificity(ours.selector), specificity(theirs.selector)) <= 0) {
          losing.push(`${ours.selector} loses ${[...new Set(shared)].join(', ')} to ${theirs.selector}`);
        }
      }
    }
    expect(losing).toEqual([]);
  });

  it('keeps a settled promise toast’s icon showing: sonner hides it and only its own animation brings it back', () => {
    const hidden = sonnerRules.find(
      (rule) => rule.selector === '[data-sonner-toast][data-promise=true] [data-icon]>svg'
    );
    expect(hidden?.properties).toEqual(['opacity', 'transform', 'transform-origin', 'animation']);
    const icon = /\[data-sonner-toast\]\[data-styled="true"\]\.bk-toast \[data-icon\] > svg \{([^}]*)\}/.exec(
      ourCss
    );
    expect(icon?.[1]).toMatch(/animation: bk-toast-icon-in [^;]* both;/);
  });

  it('overrides the parts that set the gap between a toast’s icon and its text', () => {
    const parts = new Set(toastRules.map((rule) => partOf(rule.selector)));
    for (const part of ['[data-sonner-toast]', '[data-icon]', '[data-icon] svg', '[data-content]']) {
      expect(parts).toContain(part);
    }
  });
});
