import { afterAll, describe, expect, it, spyOn } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RADIUS,
  discoverIcons,
  generateIcons,
  isKnownIcon,
  listKnownIcons,
  listSourceFiles,
  OUT,
  renderIconMarkup,
  renderIconsModule,
} from '../../scripts/icons';

const scratch = mkdtempSync(join(tmpdir(), 'shinsa-icons-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

function tree(root: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, content);
  }
  return root;
}

const known = listKnownIcons();

describe('listSourceFiles', () => {
  it('walks source files, skipping dependencies, builds, tests and dotfiles', () => {
    const root = tree(join(scratch, 'walk'), {
      'a.tsx': '',
      'sub/c.ts': '',
      'sub/d.mdx': '',
      'b.test.tsx': '',
      'notes.md': '',
      'node_modules/x.ts': '',
      'dist/y.js': '',
      'test/z.ts': '',
      '.cache/w.ts': '',
    });
    expect([...listSourceFiles(root)].map((file) => file.slice(root.length + 1)).sort()).toEqual([
      'a.tsx',
      'sub/c.ts',
      'sub/d.mdx',
    ]);
  });
});

describe('the catalog', () => {
  it('knows Central icons, their filled variants and our custom marks', () => {
    expect(isKnownIcon(known, 'IconCheckmark1')).toBe(true);
    expect(isKnownIcon(known, 'IconBellFilled')).toBe(true);
    expect(isKnownIcon(known, 'IconPriorityHigh')).toBe(true);
    expect(isKnownIcon(known, 'IconRegex')).toBe(true);
    expect(isKnownIcon(known, 'IconFileTypeTypescript')).toBe(true);
    expect(isKnownIcon(known, 'IconFolderOpenSource')).toBe(true);
    expect(isKnownIcon(known, 'IconNotARealIcon')).toBe(false);
  });
});

describe('discoverIcons', () => {
  it('finds icons by prop, by object key and by any literal that names a real icon', () => {
    const found = discoverIcons(
      [
        "<Icon name='IconBell' />",
        "const action = { icon: 'IconClock' };",
        "const fallback = 'IconGlobe';",
        "const label = 'IconNotARealIcon';",
        '<Badge icon="IconFolder1" />',
      ],
      known
    );
    expect([...found.keys()].sort()).toEqual(['IconBell', 'IconClock', 'IconFolder1', 'IconGlobe']);
    expect([...(found.get('IconBell') ?? [])]).toEqual([DEFAULT_RADIUS]);
  });

  it('adds a radius written on the same tag, ignoring radii Central does not ship', () => {
    const found = discoverIcons(
      ["<Icon name='IconBell' radius='0' /><Icon name='IconClock' radius='7' />"],
      known
    );
    expect([...(found.get('IconBell') ?? [])].sort()).toEqual(['0', '3']);
    expect([...(found.get('IconClock') ?? [])]).toEqual(['3']);
  });

  it('gives every chevron the square radius Icon resolves it to', () => {
    const found = discoverIcons(["<Icon name='IconChevronDownMedium' />"], known);
    expect([...(found.get('IconChevronDownMedium') ?? [])].sort()).toEqual(['0', '3']);
  });
});

describe('renderIconMarkup', () => {
  it('renders Central icons as raw currentColor paths', () => {
    const markup = renderIconMarkup('IconBell', '3');
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).not.toContain('<svg');
    expect(markup).not.toContain('mask');
  });

  it('renders the filled style from the Filled suffix', () => {
    expect(renderIconMarkup('IconBellFilled', '3')).not.toBe(renderIconMarkup('IconBell', '3'));
  });

  it('applies the optical corrections', () => {
    expect(renderIconMarkup('IconCheckmark1', '3')).toContain('stroke-width="2.5"');
    expect(renderIconMarkup('IconPaperPlaneTopRight', '3')).toStartWith(
      '<g transform="translate(12 12) scale(0.9) translate(-12 -12)">'
    );
    expect(renderIconMarkup('IconApple', '3')).toStartWith('<g transform="translate(0.14 -1.03)">');
  });

  it('draws every chevron to one length, at the same stroke weight', () => {
    expect(renderIconMarkup('IconChevronRightSmall', '0')).toBe(
      '<g transform="translate(12 12) scale(1.4) translate(-12 -12)"><g><path d="M10 16L14 12L10 8" stroke="currentColor" stroke-width="1.4286" stroke-linecap="round" stroke-linejoin="round"/></g></g>'
    );
    expect(renderIconMarkup('IconChevronDownMedium', '0')).toStartWith(
      '<g transform="translate(12 12) scale(0.9333) translate(-12 -12)">'
    );
    expect(renderIconMarkup('IconChevronDownMedium', '0')).toContain('stroke-width="2.1429"');
    expect(renderIconMarkup('IconChevronDoubleRight', '0')).not.toContain('scale(');
  });

  it('draws every cross to the chevron’s length on both axes, at the same stroke weight', () => {
    expect(renderIconMarkup('IconCrossSmall', '3')).toBe(
      '<g transform="translate(12 12) scale(1.4) translate(-12 -12)"><g><path d="M8 8L16 16M16 8L8 16" stroke="currentColor" stroke-width="1.4286" stroke-linecap="round"/></g></g>'
    );
    expect(renderIconMarkup('IconCrossMedium', '3')).toStartWith(
      '<g transform="translate(12 12) scale(1.0182) translate(-12 -12)">'
    );
    expect(renderIconMarkup('IconCrossMedium', '3')).toContain('stroke-width="1.9643"');
    expect(renderIconMarkup('IconCrossLarge', '3')).not.toContain('scale(');
  });

  it('draws the Settings gear as tall as the usage gauge beside it, at the same stroke weight', () => {
    const gear = renderIconMarkup('IconSettingsGear4', '2');
    expect(gear).toStartWith('<g transform="translate(12 12) scale(1.1132) translate(-12 -12)">');
    expect(gear).toContain('stroke-width="1.7966"');
    expect(renderIconMarkup('IconSettingsGear4Filled', '2')).toStartWith(
      '<g transform="translate(12 12) scale(1.1132) translate(-12 -12)">'
    );
    expect(renderIconMarkup('IconGauge', '2')).not.toContain('scale(');
  });

  it('draws Home, Tasks and Services at their matched scales, each filled twin at its outline’s scale', () => {
    for (const [name, scale] of [
      ['IconHomeRoundDoor', '1.025'],
      ['IconListBullets', '1.15'],
      ['IconServer', '1.15'],
    ] as const) {
      const transform = `<g transform="translate(12 12) scale(${scale}) translate(-12 -12)">`;
      expect(renderIconMarkup(name, '3')).toStartWith(transform);
      expect(renderIconMarkup(`${name}Filled`, '3')).toStartWith(transform);
    }
    expect(renderIconMarkup('IconHomeRoundDoor', '3')).toContain('stroke-width="1.9512"');
    expect(renderIconMarkup('IconInboxEmpty', '3')).not.toContain('scale(');
  });

  it('uses our own artwork for custom marks', () => {
    expect(renderIconMarkup('IconPriorityHigh', '0')).toStartWith('<g fill="currentColor"><rect');
    expect(renderIconMarkup('IconWholeWord', '3')).toContain('stroke="currentColor"');
  });

  it('draws a file or folder mark as its base icon in its tint, unless its row mutes it', () => {
    expect(renderIconMarkup('IconFileTypeTypescript', '3')).toBe(
      `<g style="color:var(--file-icon-ink,var(--file-blue))">${renderIconMarkup('IconTypescript', '3')}</g>`
    );
    expect(renderIconMarkup('IconFileTypePython', '3')).toBe(
      `<g style="color:var(--file-icon-ink,var(--file-yellow))">${renderIconMarkup('IconPython', '3')}</g>`
    );
    expect(renderIconMarkup('IconFolderOpenTest', '3')).toStartWith(
      '<g style="color:var(--file-icon-ink,var(--file-green))">'
    );
  });

  it('fails loudly for a name Central does not have', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(() => renderIconMarkup('IconNotARealIcon', '3')).toThrow(
      'Failed to extract SVG for IconNotARealIcon@r3'
    );
    warn.mockRestore();
  });
});

describe('renderIconsModule', () => {
  it('writes sorted names and radii, so the output is stable', () => {
    const module = renderIconsModule(
      new Map([
        ['IconClock', new Set(['3'] as const)],
        ['IconBell', new Set(['3', '0'] as const)],
      ])
    );
    expect(module.indexOf("'IconBell',")).toBeLessThan(module.indexOf("'IconClock',"));
    expect(module).toContain(`IconBell: {\n    '0': '${renderIconMarkup('IconBell', '0')}',\n    '3': `);
    expect(module).toContain("export const DEFAULT_ICON_RADIUS: IconRadius = '3';");
  });
});

describe('generateIcons', () => {
  it('scans the given roots', () => {
    const root = tree(join(scratch, 'scan'), {
      'page.tsx': "<Icon name='IconBell' /><Icon name='IconClock' />",
    });
    const { module, icons } = generateIcons([root]);
    expect(icons).toBe(2);
    expect(module).toContain("'IconBell',\n  'IconClock',\n] as const;");
  });

  it('refuses to write an empty icon set', () => {
    const root = tree(join(scratch, 'empty'), { 'page.tsx': 'export {};' });
    expect(() => generateIcons([root])).toThrow('No icon usages found');
  });

  it('matches the committed paths.ts, so the bundle carries exactly the icons the workspace uses', () => {
    expect(generateIcons().module).toBe(readFileSync(OUT, 'utf8'));
  });
});
