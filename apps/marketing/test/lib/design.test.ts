import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CUSTOM_ICON_PATHS } from '../../../../packages/ui/src/components/icon/custom.ts';
import { ICON_NAMES } from '../../../../packages/ui/src/components/icon/paths.ts';
import * as lintRules from '../../../../scripts/lint-rules.ts';
import { type DesignSources, listTokenNames, serializeDesign, slugify } from '../../src/lib/design.ts';

const ROOT = join(import.meta.dir, '../../../..');

const COMPONENTS = join(ROOT, 'packages/ui/src/components');

const SKILL_RULES: Record<string, readonly string[]> = {
  '.claude/skills/design/SKILL.md': [
    'MATCHED_SCALE',
    'TOOLTIP_DELAY',
    'COMPACT_POPOVER',
    'faux-medium',
    "variant='bare'",
    'useTooltipTrigger',
    'selectable',
    'CheckOutcomeIcon',
    'DIALOG_MOTION',
  ],
  '.claude/skills/copy/SKILL.md': [
    'Each string has one job',
    'Answer the question.',
    'pushing the changes',
    'All 1 checks passed',
    'lowerFirst',
    'VOICE_RULE',
    'Out of automatic fix rounds',
    'The agent review found',
    'Answered. The agent carries on.',
    'Check in now',
  ],
  '.claude/skills/conventions/SKILL.md': [
    'UserCommand',
    'sendCommand',
    'DomainError',
    '.catch(() => undefined)',
    'select*',
    'reactTo*',
    'single-use constants',
    'describeError',
  ],
  '.claude/skills/review/SKILL.md': [
    'bunx biome ci .',
    'bun lint:conventions',
    'valid, stale',
    'Lead with the verdict',
    'passes either way',
    'Coverage counts arrow functions',
    'tsc --noEmit',
  ],
  'apps/engine/plugin/skills/evidence/SKILL.md': [
    'attach_evidence',
    'Before shots first',
    'git worktree add --detach /tmp/before',
    '5 to 20 seconds',
    'Settings, appearance section',
    'The muted labels now pass 4.5:1 contrast.',
    'Never claim something works',
  ],
  'apps/engine/plugin/skills/handover/SKILL.md': [
    'propose_plan',
    'complete_phase',
    'complete_fix',
    'reshape_task',
    'judgement_calls',
    'Poll instead of webhooks',
    '```bash run',
    'pre_merge',
    'post_merge',
    'shinsa://file/',
    'Offsets shift during an',
  ],
  'apps/engine/plugin/skills/review/SKILL.md': [
    'report_review',
    'disagreements',
    'never the approval',
    'A check that fails because of the change is always',
  ],
};

function readText(path: string) {
  return readFileSync(join(ROOT, path), 'utf8');
}

function createSources(source = readText('docs/design-system.md')): DesignSources {
  return {
    source,
    kitStylesheet: readText('packages/ui/src/styles/globals.css'),
    webStylesheets: [
      { name: 'app.css', css: readText('apps/web/src/app.css') },
      { name: 'desktop.css', css: readText('apps/web/src/desktop.css') },
    ],
    tailwindTheme: readText('apps/marketing/node_modules/tailwindcss/theme.css'),
    iconNames: ICON_NAMES,
    customIconNames: Object.keys(CUSTOM_ICON_PATHS),
    lint: lintRules,
  };
}

function listExports(source: string) {
  const declared = [...source.matchAll(/^export (?:async )?(?:function|const|class) (\w+)/gm)].map(
    (match) => match[1] ?? ''
  );
  const listed = [...source.matchAll(/^export \{([^}]*)\}/gm)].flatMap((match) =>
    (match[1] ?? '')
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name.length > 0 && !name.startsWith('type '))
      .map((name) => name.split(/\s+as\s+/).at(-1) ?? name)
  );
  return [...declared, ...listed];
}

function listComponentExports() {
  const files = [
    ...readdirSync(COMPONENTS)
      .filter((name) => name.endsWith('.tsx'))
      .map((name) => join(COMPONENTS, name)),
    join(COMPONENTS, 'icon/index.tsx'),
  ];
  return files.flatMap((file) =>
    listExports(readFileSync(file, 'utf8'))
      .filter((name) => name !== 'ICON_NAMES')
      .map((name) => ({ file: file.slice(COMPONENTS.length + 1), name }))
  );
}

describe('the design system file', () => {
  const design = serializeDesign(createSources());

  it('names every token the kit declares', () => {
    const tokens = listTokenNames(readText('packages/ui/src/styles/globals.css'));
    expect(tokens.length).toBeGreaterThan(200);
    expect(tokens.filter((token) => !design.includes(`\`${token}\``))).toEqual([]);
  });

  it('documents every component the kit exports', () => {
    const exports = listComponentExports();
    expect(exports.length).toBeGreaterThan(100);
    expect(exports.filter(({ name }) => !new RegExp(`\\b${name}\\b`).test(design))).toEqual([]);
  });

  it('lists every icon by its exact name', () => {
    expect(ICON_NAMES.filter((name) => !design.includes(`\`${name}\``))).toEqual([]);
  });

  it('runs every class rule the linter runs', () => {
    for (const rule of lintRules.CLASS_RULES) expect(design).toContain(rule.pattern.source);
    expect(design).toContain(lintRules.BANNED_VERB_PATTERN.source);
  });

  it('opens with a table of contents that links every section', () => {
    const sections = design.split('\n').filter((line) => line.startsWith('## '));
    expect(sections.length).toBeGreaterThan(10);
    for (const section of sections) expect(design).toContain(`(#${slugify(section.slice(3))})`);
    expect(design).not.toContain('<!-- design:');
  });

  it('keeps the key rules of every design, copy, conventions, review and hand-over skill', () => {
    const missing = Object.entries(SKILL_RULES).flatMap(([skill, phrases]) => {
      const text = readText(skill);
      return phrases
        .filter((phrase) => !(text.includes(phrase) && design.includes(phrase)))
        .map((phrase) => `${skill}: ${phrase}`);
    });
    expect(missing).toEqual([]);
  });

  it('refuses a source with an unknown or a missing section', () => {
    expect(() => serializeDesign(createSources('<!-- design:tokenz -->'))).toThrow('Unknown design marker');
    expect(() => serializeDesign(createSources('# Shinsa'))).toThrow('Missing design markers');
  });
});

describe('slugify', () => {
  it('links a heading the way GitHub anchors it', () => {
    expect(slugify('12. Content and copy')).toBe('12-content-and-copy');
    expect(slugify('Radius and shape: carve-outs')).toBe('radius-and-shape-carve-outs');
  });
});
