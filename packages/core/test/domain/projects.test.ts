import { describe, expect, test } from 'bun:test';
import {
  formatTaskHandle,
  isProjectKey,
  NO_PROJECT_KEY,
  type Project,
  parseTaskHandle,
  resolveProjectKey,
  selectFolderProject,
} from '../../src/index.ts';

function project(id: string, folders: string[]): Project {
  return { id, name: id, color: 'blue', key: id.toUpperCase(), description: '', folders };
}

describe('project keys', () => {
  test('a key is 2 to 6 capital letters or digits starting with a letter', () => {
    expect(['SW', 'BAS', 'SUP2', 'ABCDEF', 'T2'].every(isProjectKey)).toBe(true);
    expect(['S', 'sw', '2SW', 'ABCDEFG', 'S-W', ''].some(isProjectKey)).toBe(false);
  });

  test('a name of several words gives its initials, camel case counting as words', () => {
    expect(resolveProjectKey('Superwall Web', [])).toBe('SW');
    expect(resolveProjectKey('paywallEditor', [])).toBe('PE');
    expect(resolveProjectKey('The Big Shiny Rewrite Project', [])).toBe('TBSR');
  });

  test('a name of one word gives its first three letters, then its first two', () => {
    expect(resolveProjectKey('Basket', [])).toBe('BAS');
    expect(resolveProjectKey('Basket', ['BAS'])).toBe('BA');
    expect(resolveProjectKey('Superwall Web', ['SW'])).toBe('SUP');
  });

  test('when every candidate is taken, a number makes the key unique', () => {
    expect(resolveProjectKey('Basket', ['BAS', 'BA'])).toBe('BAS2');
    expect(resolveProjectKey('Basket', ['BAS', 'BA', 'BAS2', 'BAS3'])).toBe('BAS4');
  });

  test('a long number shortens the base so the key stays six characters and unique', () => {
    const taken = ['ABGD', 'ALP', 'AL', ...Array.from({ length: 98 }, (_, index) => `ABGD${index + 2}`)];
    const key = resolveProjectKey('Alpha Beta Gamma Delta', taken);
    expect(key).toBe('ABG100');
    expect(isProjectKey(key)).toBe(true);
  });

  test('a name without letters to start a key falls back to P, and then PR with a number', () => {
    expect(resolveProjectKey('2024', [])).toBe('PR2');
    expect(resolveProjectKey('Q', [])).toBe('PR2');
    expect(resolveProjectKey('Q', ['PR2'])).toBe('PR3');
  });
});

describe('task handles', () => {
  test('a handle is the key, a dash and the number', () => {
    expect(formatTaskHandle('SW', 142)).toBe('SW-142');
    expect(formatTaskHandle(NO_PROJECT_KEY, 3)).toBe('T-3');
  });

  test('reading a handle ignores case, spaces and leading zeros', () => {
    expect(parseTaskHandle('sw-142')).toBe('SW-142');
    expect(parseTaskHandle('  t-007 ')).toBe('T-7');
  });

  test('text that is not a handle reads as nothing', () => {
    for (const text of ['SW142', 'SW-', '-1', '1-SW', 'TOOLONGKEY-1', 'SW-1234567890', 'see SW-1']) {
      expect(parseTaskHandle(text)).toBeNull();
    }
  });
});

describe('project folders', () => {
  test('a path is inside a folder when it is the folder or below it, never a sibling with the same start', () => {
    const basket = project('basket', ['/code/basket/']);
    expect(selectFolderProject([basket], '/code/basket')?.id).toBe('basket');
    expect(selectFolderProject([basket], '/code/basket/app')?.id).toBe('basket');
    expect(selectFolderProject([basket], '/code/basket-old')).toBeNull();
    expect(selectFolderProject([project('root', ['/'])], '/code')).toBeNull();
  });

  test('the project of a path is the one with the longest folder holding it', () => {
    const code = project('code', ['/code']);
    const sdk = project('sdk', ['/elsewhere', '/code/basket/sdk']);
    expect(selectFolderProject([code, sdk], '/code/basket/sdk/ios')?.id).toBe('sdk');
    expect(selectFolderProject([sdk, code], '/code/basket/app')?.id).toBe('code');
    expect(selectFolderProject([code, sdk], '/tmp/app')).toBeNull();
  });
});
