import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import {
  bumpLockfileEntry,
  countLines,
  createRandom,
  FIXTURE_SPOTS_PER_SECTION,
  insertAfterImports,
  insertBeforeLastHeading,
  listEditHunks,
  replaceAllRequired,
  replaceRequired,
  resolveCrc32,
  resolveImportsEnd,
  resolveLine,
  serializeFastImport,
  serializeNumberedLines,
  serializePng,
  serializeRectsPng,
  serializeReviewFixture,
} from './seed-code-kit.ts';

function listChunks(png: Uint8Array) {
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const chunks: { type: string; data: Uint8Array; valid: boolean }[] = [];
  let at = 8;
  while (at < png.length) {
    const length = view.getUint32(at);
    const type = new TextDecoder().decode(png.subarray(at + 4, at + 8));
    const data = png.subarray(at + 8, at + 8 + length);
    const crc = view.getUint32(at + 8 + length);
    chunks.push({ type, data, valid: crc === resolveCrc32(png.subarray(at + 4, at + 8 + length)) });
    at += 12 + length;
  }
  return chunks;
}

function readPixel(png: Uint8Array, width: number, x: number, y: number) {
  const idat = listChunks(png).find((chunk) => chunk.type === 'IDAT');
  if (!idat) throw new Error('No image data.');
  const rows = inflateSync(idat.data);
  const offset = y * (1 + width * 3) + 1 + x * 3;
  return [rows[offset], rows[offset + 1], rows[offset + 2]];
}

function git(args: string[], cwd: string, input?: Uint8Array) {
  const result = Bun.spawnSync(['git', ...args], {
    cwd,
    stdin: input ?? 'ignore',
    env: { ...Bun.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' },
  });
  if (result.exitCode !== 0) throw new Error(result.stderr.toString());
  return result.stdout.toString().trim();
}

describe('resolveCrc32', () => {
  test('matches the standard check value', () => {
    expect(resolveCrc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});

describe('serializePng', () => {
  test('writes a valid RGB image of the asked size', () => {
    const png = serializePng(3, 2, (x, y) => [x * 10, y * 20, 7]);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunks = listChunks(png);
    expect(chunks.map((chunk) => chunk.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(chunks.every((chunk) => chunk.valid)).toBe(true);
    const header = new DataView(chunks[0]?.data.buffer ?? new ArrayBuffer(0), chunks[0]?.data.byteOffset);
    expect([header.getUint32(0), header.getUint32(4)]).toEqual([3, 2]);
    expect(readPixel(png, 3, 2, 1)).toEqual([20, 20, 7]);
  });

  test('paints the last rectangle that covers a pixel, and the background elsewhere', () => {
    const png = serializeRectsPng(
      4,
      4,
      [1, 1, 1],
      [
        { x: 0, y: 0, width: 4, height: 4, color: [9, 9, 9] },
        { x: 1, y: 1, width: 1, height: 1, color: [200, 0, 0] },
      ]
    );
    expect(readPixel(png, 4, 1, 1)).toEqual([200, 0, 0]);
    expect(readPixel(png, 4, 3, 3)).toEqual([9, 9, 9]);
    const empty = serializeRectsPng(2, 2, [1, 2, 3], []);
    expect(readPixel(empty, 2, 0, 0)).toEqual([1, 2, 3]);
  });
});

describe('replaceRequired', () => {
  test('replaces whole identifiers only', () => {
    expect(replaceRequired('target targets formatTarget(target)', 'target', 'spot', 'a.ts')).toBe(
      'spot targets formatTarget(spot)'
    );
  });

  test('replaces any text that is not an identifier as it is', () => {
    expect(replaceRequired("from './targets.ts'", './targets.ts', './spots.ts', 'a.ts')).toBe(
      "from './spots.ts'"
    );
  });

  test('names the file and the text when the text is missing', () => {
    expect(() => replaceRequired('nothing here', 'ReviewTarget', 'ReviewSpot', 'a.ts')).toThrow(
      'a.ts: “ReviewTarget” is not in the file'
    );
  });

  test('applies pairs in order', () => {
    expect(
      replaceAllRequired(
        'ReviewTarget target',
        [
          ['ReviewTarget', 'ReviewSpot'],
          ['target', 'spot'],
        ],
        'a.ts'
      )
    ).toBe('ReviewSpot spot');
  });
});

describe('resolveLine', () => {
  test('finds the first line holding the text, from a starting line', () => {
    const content = 'a\nneedle one\nb\nneedle two';
    expect(resolveLine(content, 'needle')).toBe(2);
    expect(resolveLine(content, 'needle', 2)).toBe(4);
  });

  test('throws when the text is missing', () => {
    expect(() => resolveLine('a\nb', 'needle')).toThrow('“needle” is not in the seeded file');
  });
});

describe('insertAfterImports', () => {
  test('goes after the last import, multi-line ones included', () => {
    const content = "import a from 'a';\nimport {\n  b,\n} from 'b';\n\nconst c = 'c';";
    expect(resolveImportsEnd(content)).toBe(4);
    expect(insertAfterImports(content, "import d from 'd';").split('\n').slice(3, 5)).toEqual([
      "} from 'b';",
      "import d from 'd';",
    ]);
  });

  test('goes first in a file with no imports', () => {
    expect(insertAfterImports("const a = 'a';", "import d from 'd';")).toBe(
      "import d from 'd';\nconst a = 'a';"
    );
  });
});

describe('insertBeforeLastHeading', () => {
  test('puts the block before the last second-level heading', () => {
    expect(insertBeforeLastHeading('# Doc\n## One\n## Two\ntext', '## New')).toBe(
      '# Doc\n## One\n## New\n## Two\ntext'
    );
  });

  test('throws without one', () => {
    expect(() => insertBeforeLastHeading('# Doc', '## New')).toThrow('no second-level heading');
  });
});

describe('bumpLockfileEntry', () => {
  const lockfile = [
    '{',
    '  "workspaces": {',
    '    "": { "name": "x" },',
    '  },',
    '  "packages": {',
    '    "@scope/sdk": ["@scope/sdk@1.2.3", "", { "dependencies": { "@scope/sdk-darwin": "1.2.3" } }, "sha512-aaa=="],',
    '',
    '    "@scope/sdk-darwin": ["@scope/sdk-darwin@1.2.3", "", { "os": "darwin" }, "sha512-ccc=="],',
    '',
    '    "leaf": ["leaf@4.5.6", "", {}, "sha512-bbb=="],',
    '  }',
    '}',
  ].join('\n');

  test('moves the first package no other package pins, by one patch', () => {
    const bump = bumpLockfileEntry(lockfile);
    expect(bump).toMatchObject({ name: 'leaf', from: '4.5.6', to: '4.5.7', line: 10 });
    const line = bump.content.split('\n')[9] ?? '';
    expect(line).toStartWith('    "leaf": ["leaf@4.5.7", "", {}, "sha512-');
    expect(line).not.toContain('sha512-bbb==');
    expect(bump.content.split('\n')[5]).toBe(lockfile.split('\n')[5]);
  });

  test('is the same every time', () => {
    expect(bumpLockfileEntry(lockfile).content).toBe(bumpLockfileEntry(lockfile).content);
  });

  test('throws when there is nothing to move', () => {
    expect(() => bumpLockfileEntry('{\n  "packages": {\n  }\n}')).toThrow('no package entry');
  });
});

describe('listEditHunks', () => {
  test('lists each run of replaced lines when the line count stays', () => {
    expect(listEditHunks('a\nb\nc\nd\ne', 'a\nB\nc\nD\nE')).toEqual([
      { before: 'b', after: 'B' },
      { before: 'd\ne', after: 'D\nE' },
    ]);
  });

  test('anchors an insertion on the line before it', () => {
    expect(listEditHunks('a\nb\nc', 'a\nb\nx\ny\nc')).toEqual([{ before: 'b', after: 'b\nx\ny' }]);
  });
});

describe('text helpers', () => {
  test('numbers a range of lines', () => {
    expect(serializeNumberedLines('a\nb\nc\nd', 2, 3)).toBe('2\tb\n3\tc');
  });

  test('counts lines with and without a final newline', () => {
    expect(countLines('a\nb\n')).toBe(2);
    expect(countLines('a\nb')).toBe(2);
  });

  test('draws the same numbers from the same seed, between 0 and 1', () => {
    const first = createRandom(7);
    const second = createRandom(7);
    const draws = Array.from({ length: 5 }, () => first());
    expect(draws).toEqual(Array.from({ length: 5 }, () => second()));
    expect(draws.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});

describe('serializeReviewFixture', () => {
  test('differs between the two words in exactly three lines', () => {
    const before = serializeReviewFixture('target', 6).split('\n');
    const after = serializeReviewFixture('spot', 6).split('\n');
    expect(after).toHaveLength(before.length);
    const changed = before.flatMap((line, index) => (line === after[index] ? [] : [after[index]]));
    expect(changed).toEqual([
      'export const LARGE_REVIEW_SPOT_COUNT = 60;',
      "          why: 'The first review spot in this file.',",
      "          why: 'The last review spot in this file.',",
    ]);
  });

  test('grows by one section of spots at a time', () => {
    const lines = (sections: number) => countLines(serializeReviewFixture('spot', sections));
    expect(lines(3) - lines(2)).toBe(4 + FIXTURE_SPOTS_PER_SECTION * 7 + 2);
  });
});

describe('serializeFastImport', () => {
  test('imports commits with their files, dates and modes', () => {
    const repo = mkdtempSync(join(tmpdir(), 'seed-code-kit-'));
    try {
      git(['init', '-q', '-b', 'main'], repo);
      const encode = (text: string) => new TextEncoder().encode(text);
      const stream = serializeFastImport('refs/heads/main', 'Seed <seed@example.com>', [
        {
          message: 'first',
          at: 1_000_000,
          files: [{ path: 'a.txt', mode: '100644', content: encode('one\n') }],
        },
        {
          message: 'second',
          at: 2_000_000,
          files: [{ path: 'bin/run with space', mode: '100755', content: encode('#!/bin/sh\n') }],
        },
      ]);
      git(['fast-import', '--quiet'], repo, stream);
      expect(git(['log', '--format=%s %at %an', 'main'], repo)).toBe('second 2000 Seed\nfirst 1000 Seed');
      expect(git(['show', 'main:a.txt'], repo)).toBe('one');
      expect(git(['ls-tree', '-r', 'main'], repo)).toContain('100755 blob');
      expect(git(['ls-tree', '-r', '--name-only', 'main'], repo).split('\n')).toEqual([
        'a.txt',
        'bin/run with space',
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});
