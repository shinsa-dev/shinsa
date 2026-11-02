import { describe, expect, test } from 'bun:test';
import { cognitiveComplexity } from './rules/cognitive-complexity.ts';
import { noAccumulatingSpread } from './rules/no-accumulating-spread.ts';
import { noArrayIndexKey } from './rules/no-array-index-key.ts';
import { noAwaitInTernary } from './rules/no-await-in-ternary.ts';
import { noDynamicNamespaceImportAccess } from './rules/no-dynamic-namespace-import-access.ts';
import { noEvolvingTypes } from './rules/no-evolving-types.ts';
import { noForEach } from './rules/no-for-each.ts';
import { noInvalidBuiltinInstantiation } from './rules/no-invalid-builtin-instantiation.ts';
import { noRedundantUseStrict } from './rules/no-redundant-use-strict.ts';
import { noSuspiciousSemicolonInJsx } from './rules/no-suspicious-semicolon-in-jsx.ts';
import { noThisInStatic } from './rules/no-this-in-static.ts';
import { noUselessContinue } from './rules/no-useless-continue.ts';
import { noUselessElse } from './rules/no-useless-else.ts';
import { noUselessStringRaw } from './rules/no-useless-string-raw.ts';
import { noUselessUndefinedInitialization } from './rules/no-useless-undefined-initialization.ts';
import { useAwait } from './rules/use-await.ts';
import { useOptionalChain } from './rules/use-optional-chain.ts';
import { useSemanticElements } from './rules/use-semantic-elements.ts';
import { useSimpleNumberKeys } from './rules/use-simple-number-keys.ts';
import { useTemplate } from './rules/use-template.ts';
import { listReports } from './testing.ts';
import type { Rule } from './types.ts';

const linesOf = (rule: Rule, code: string, filename?: string) =>
  listReports(rule, code, filename).map((report) => report.line);

describe('the Shinsa Oxlint rules report what Biome reported', () => {
  test('a ternary that wraps an await is reported on its condition', () => {
    const code = [
      'const a = ready ? await load() : null;',
      'const b = ready ? null : list(await load());',
      'const c = ready ? async () => await load() : null;',
      'const d = ready ? load() : null;',
    ].join('\n');
    expect(linesOf(noAwaitInTernary, code)).toEqual([1, 2, 3]);
    expect(listReports(noAwaitInTernary, code)[0]?.message).toContain('Ternaries never wrap awaited calls');
  });

  test('a let with no type and no value, or only null or undefined, evolves into any', () => {
    const code = [
      'let a;',
      'let b = null;',
      'let c = undefined;',
      'let d: number;',
      'let e = 1;',
      'const f = null;',
      'for (let g of list) use(g);',
      'for (let h in map) use(h);',
      'let [i] = list;',
      'var j;',
    ].join('\n');
    expect(linesOf(noEvolvingTypes, code, 'sample.ts')).toEqual([1, 2, 3, 10]);
    expect(linesOf(noEvolvingTypes, 'let a;', 'sample.js')).toEqual([]);
  });

  test('an else after a branch that always leaves is not needed', () => {
    const code = [
      'function a(x) {',
      '  if (x) { return 1; } else { return 2; }',
      '  if (x) throw new Error("x"); else use(x);',
      '  for (const y of x) { if (y) { continue; } else { use(y); } }',
      '  if (x) { use(x); } else { return 3; }',
      '  if (x) {} else { use(x); }',
      '  if (x) return 4;',
      '}',
    ].join('\n');
    expect(linesOf(noUselessElse, code)).toEqual([2, 3, 4]);
  });

  test('a let or var set to undefined says what it already is', () => {
    const code = ['let a = undefined;', 'var b = undefined;', 'const c = undefined;', 'let d = null;'].join(
      '\n'
    );
    expect(linesOf(noUselessUndefinedInitialization, code)).toEqual([1, 2]);
  });

  test('this and super in a static member are reported, in instance members and functions they are not', () => {
    const code = [
      'class A extends B {',
      '  static make() { return this.name; }',
      '  static value = super.value;',
      '  static { this.ready = true; }',
      '  static nested() { return function () { return this; }; }',
      '  static arrow() { return () => this; }',
      '  make() { return this.name; }',
      '}',
      'function free() { return this; }',
      'this.top;',
    ].join('\n');
    expect(linesOf(noThisInStatic, code)).toEqual([2, 3, 4, 6]);
    expect(listReports(noThisInStatic, code)[1]?.message).toContain('`super`');
  });

  test('a continue that is the last step of a loop is not needed', () => {
    const code = [
      'for (const a of b) { continue; }',
      'for (const a of b) { if (a) { continue; } else { use(a); } }',
      'while (b) continue;',
      'for (const a of b) { if (a) continue; use(a); }',
      'outer: for (const a of b) { continue outer; }',
      'for (const a of b) { switch (a) { case 1: continue; } }',
      'function f() { continue; }',
    ].join('\n');
    expect(linesOf(noUselessContinue, code)).toEqual([1, 2, 3]);
  });

  test('String.raw around a string with no backslash is not needed', () => {
    const code = [
      'String.raw`plain`;',
      'String.raw`a\\nb`;',
      'String["raw"]`plain`;',
      'Other.raw`plain`;',
      'String.other`plain`;',
      'tag`plain`;',
    ].join('\n');
    expect(linesOf(noUselessStringRaw, code)).toEqual([1]);
  });

  test('a number key written in another base or with separators is reported', () => {
    const code = 'const a = { 0x1: 1, 0b1: 2, 0o1: 3, 1_000: 4, 1: 5, 1.5: 6, "0x1": 7, [0x1]: 8 };';
    expect(listReports(useSimpleNumberKeys, code)).toHaveLength(4);
  });

  test('a namespace import read with a computed key is reported, a literal key is not', () => {
    const code = [
      "import * as icons from './icons';",
      "import { other } from './other';",
      'icons[name];',
      "icons['Close'];",
      'icons.Close;',
      'other[name];',
    ].join('\n');
    expect(linesOf(noDynamicNamespaceImportAccess, code)).toEqual([3]);
  });

  test('"use strict" in a module is reported', () => {
    expect(linesOf(noRedundantUseStrict, '"use strict";\nfunction a() { "use strict"; }\n"other";')).toEqual([
      1, 2,
    ]);
  });

  test('a semicolon after a JSX element is shown as text', () => {
    const code = [
      'const a = (',
      '  <div>',
      '    <span />;',
      '    <span />',
      '  </div>',
      ');',
      'const b = (',
      '  <>',
      '    <span />;',
      '  </>',
      ');',
      'const c = (',
      '  <div>',
      '    text;',
      '    {value};',
      '  </div>',
      ');',
    ].join('\n');
    expect(linesOf(noSuspiciousSemicolonInJsx, code)).toEqual([3, 9]);
  });

  test('a guard before each step of a chain is an optional chain', () => {
    const code = [
      'a && a.b;',
      'a != null && a.b;',
      'a !== undefined && a.b;',
      "typeof a.b !== 'undefined' && a.b.c;",
      '!a || !a.b;',
      'a == null || !a.b;',
      'a && a.b && a.b.c();',
      'a && a.b.c > 1;',
      "typeof a !== 'undefined' && a.b;",
      'a && b.c;',
      'a ?? a.b;',
      '(a || {}).b;',
      '(a || { b: 1 }).b;',
      '(a && b).c;',
      'null != a && a.b;',
      "typeof a !== 'object' && a.b;",
      'a < b && a.c;',
      'a && (a).b;',
      'f() && f().b;',
    ].join('\n');
    expect(linesOf(useOptionalChain, code)).toEqual([1, 2, 3, 4, 5, 6, 7, 12, 15, 18, 19]);
  });

  test('an async function with a block body and nothing awaited is reported', () => {
    const code = [
      'async function a() { return 1; }',
      'const b = async () => { use(); };',
      'const c = async () => load();',
      'async function d() { await load(); }',
      'async function e() { for await (const x of y) use(x); }',
      'async function f() { const g = async () => { await load(); }; return g; }',
      'function h() { return 1; }',
      'class I { async j() { return 1; } }',
    ].join('\n');
    expect(linesOf(useAwait, code)).toEqual([1, 2, 6, 8]);
  });

  test('built-ins that need new are called with it, and Symbol and BigInt are not', () => {
    const code = [
      'Map();',
      'new Map();',
      'Array(3);',
      'new Symbol("a");',
      'Symbol("a");',
      'new BigInt(1);',
      'new Date();',
      'make.Map();',
    ].join('\n');
    expect(linesOf(noInvalidBuiltinInstantiation, code)).toEqual([1, 4, 6]);
  });

  test('a reducer that spreads its accumulator is reported', () => {
    const code = [
      'list.reduce((acc, x) => [...acc, x], []);',
      'list.reduceRight((acc, x) => ({ ...acc, [x]: 1 }), {});',
      'list.reduce((acc, x) => { acc.push(x); return acc; }, []);',
      'list.reduce(join, []);',
      'list.reduce(([first], x) => [...first, x], []);',
      'list.map((acc) => [...acc]);',
      'list["reduce"]((acc) => [...acc]);',
      'reduce((acc) => [...acc]);',
      'list.reduce();',
    ].join('\n');
    expect(linesOf(noAccumulatingSpread, code)).toEqual([1, 2]);
  });

  test('a role with an element of its own is reported on the element', () => {
    const code = [
      "<div role='button' />;",
      "<div\n  role='treeitem'\n/>;",
      "<span role='link' />;",
      '<div role={role} />;',
      '<div aria-label="x" />;',
    ].join('\n');
    expect(linesOf(useSemanticElements, code)).toEqual([1, 5]);
  });

  test('text joined with a value on one line is a template literal', () => {
    const code = [
      "const a = 'x' + value;",
      "const b = 'x' + 'y';",
      "const c = 'x' +\n  value;",
      'const d = one + two;',
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- the code under test holds template literals
      "const e = `x${value}` + 'y' + value;",
      'const f = 1 - 2;',
    ].join('\n');
    expect(linesOf(useTemplate, code)).toEqual([1, 6]);
  });

  test('a forEach whose callback does not use the index is a for…of loop', () => {
    const code = [
      'list.forEach((item) => use(item));',
      'list.forEach((item, index) => use(item, index));',
      'list.forEach(use);',
      'list["forEach"]((item) => use(item));',
      'list.map((item) => use(item));',
      'forEach((item) => use(item));',
      'list.forEach();',
    ].join('\n');
    expect(linesOf(noForEach, code)).toEqual([1]);
  });

  test('a key that is the position in the list is reported', () => {
    const code = [
      'list.map((item, index) => <a key={index} />);',
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- the code under test holds template literals
      'list.map((item, index) => <a key={`row-${index}`} />);',
      // oxlint-disable-next-line eslint/no-template-curly-in-string -- the code under test holds template literals
      'list.map((item, index) => <a key={`${list.length - index}`} />);',
      'list.map((item, index) => <a key={String(index)} />);',
      'list.map((item, index) => <a key={index.toString()} />);',
      'Array.from(list, (item, level) => <a key={level} />);',
      'list.reduce((all, item, index) => [...all, <a key={index} />], []);',
      'list.map((item, index) => <a key={item.id ?? index} />);',
      'list.map((item) => <a key={item.id} />);',
      'list.map((item, { index }) => <a key={index} />);',
      'list.map((item, index) => <a key="fixed" />);',
      'list.map((item, index) => <a id={index} />);',
      'build((item, index) => <a key={index} />);',
      'list["map"]((item, index) => <a key={index} />);',
      'Object.from(list, (item, index) => <a key={index} />);',
      'list.map((item, index) => <a key={format(index)} />);',
      '<a key={index} />;',
      '<a key />;',
    ].join('\n');
    expect(linesOf(noArrayIndexKey, code)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  test('a function past a cognitive complexity of 25 is reported with its score', () => {
    const branches = Array.from({ length: 26 }, (_, at) => `  if (x === ${at}) use(${at});`).join('\n');
    const simple = `function simple(x) {\n${branches.split('\n').slice(0, 25).join('\n')}\n}`;
    const complex = `function complex(x) {\n${branches}\n}`;
    expect(linesOf(cognitiveComplexity, simple)).toEqual([]);
    expect(listReports(cognitiveComplexity, complex)[0]?.message).toContain('is 26, past 25');
  });

  test('cognitive complexity counts nesting, else branches, logical runs and labelled jumps', () => {
    const body = [
      'function scored(a, b, c) {',
      '  for (const x of a) {',
      '    if (x) { use(); } else if (b) { use(); } else { use(); }',
      '    switch (x) { case 1: break; }',
      '    try { use(); } catch { use(); }',
      '    const y = (a && b && c) || a;',
      '    const z = x ? 1 : 2;',
      '    while (b) { do { break; } while (c); }',
      '    outer: for (const q of a) { continue outer; }',
      '    use(() => { if (a) use(); });',
      '  }',
      '}',
    ].join('\n');
    const padded = body.replace('{\n', `{\n${'  if (pad) use();\n'.repeat(10)}`);
    expect(listReports(cognitiveComplexity, padded)[0]?.message).toContain('is 31, past 25');
    const declared = 'declare function only(): void;';
    expect(linesOf(cognitiveComplexity, declared, 'sample.ts')).toEqual([]);
  });

  test('a nested function is scored from the nesting it sits in', () => {
    const ifs =
      'if (a) use(); if (b) use(); if (c) use(); if (d) use(); if (e) use(); if (f) use(); if (g) use();';
    const code = `function outer() { if (z) { return () => { ${ifs} ${ifs} } } }`;
    const reports = listReports(cognitiveComplexity, code);
    expect(reports.map((report) => report.message)).toEqual([
      "This function's cognitive complexity is 42, past 25. Split it into smaller steps.",
    ]);
  });
});
