import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import type { Coverage, CoverageFile } from '@shinsa/core';
import {
  changeCoverage,
  countUncoveredFiles,
  createCoverageDraft,
  describeAutoCoverage,
  describeCoverageChange,
  describeCoverageFact,
  describeCoverageSummary,
  describeFileCoverage,
  describeFilesToggle,
  describeInferredFormat,
  describeRangeLabel,
  isFileCovered,
  listCoverageItems,
  listFormatChoices,
  resolveDraftCoverage,
  validateCoverageDraft,
} from '@/lib/coverage.ts';
import { spyOnCommands } from '../support/commands.ts';
import { createFullCoverage, createPartialCoverage } from '../support/coverage.ts';
import { createRepo } from '../support/state.ts';

let spies: ReturnType<typeof spyOnCommands>;

beforeEach(() => {
  spies = spyOnCommands();
});

afterEach(() => {
  spies.restore();
});

const UNAVAILABLE: Coverage = {
  status: 'unavailable',
  command: 'bun test',
  reason: 'The report is missing.',
};

describe('the coverage setting', () => {
  it('says what Auto measures with, while it looks, once it finds a tool and when it finds none', () => {
    const web = createRepo({ id: 'web' });
    expect(describeAutoCoverage(web, null)).toBe('Looking for a coverage tool in this repository.');
    expect(describeAutoCoverage(web, {})).toBe('Found no coverage tool here, so nothing is measured.');
    expect(describeAutoCoverage(web, { web: null })).toBe(
      'Found no coverage tool here, so nothing is measured.'
    );
    expect(describeAutoCoverage(web, { web: { tool: 'Vitest', command: 'npx vitest run' } })).toBe(
      'Measures with Vitest.'
    );
  });

  it('offers Auto, Custom and Off, each with a hint', () => {
    const items = listCoverageItems(createRepo({ id: 'web' }), {
      web: { tool: 'Jest', command: 'npx jest' },
    });
    expect(items.map((item) => [item.value, item.label, item.hint])).toEqual([
      ['auto', 'Auto coverage', 'Measures with Jest.'],
      ['custom', 'Custom coverage', 'Runs your command and reads the report it writes.'],
      ['off', 'Coverage off', 'Nothing is measured.'],
    ]);
  });

  it('saves a new setting with a toast that says what changes, and nothing for the current one', async () => {
    const web = createRepo({ id: 'web', name: 'web' });
    expect(await changeCoverage(web, { mode: 'auto' })).toBe(true);
    expect(spies.sent).not.toHaveBeenCalled();
    await changeCoverage(web, { mode: 'off' });
    expect(spies.sent).toHaveBeenCalledWith(
      { type: 'repo.update', repoId: 'web', patch: { coverage: { mode: 'off' } } },
      'Shinsa no longer measures test coverage in web.'
    );
    expect(describeCoverageChange(web, { mode: 'auto' })).toBe(
      'The next checks in web measure test coverage with the tool Shinsa finds.'
    );
    expect(
      describeCoverageChange(web, {
        mode: 'custom',
        command: 'make cover',
        report: 'cover.out',
        format: null,
      })
    ).toBe('The next checks in web measure test coverage with your command.');
  });

  it('starts the dialog empty, or from the custom command already set', () => {
    expect(createCoverageDraft(createRepo({ id: 'web' }))).toEqual({
      command: '',
      report: '',
      format: 'infer',
    });
    expect(
      createCoverageDraft(
        createRepo({
          id: 'web',
          coverage: { mode: 'custom', command: 'make cover', report: 'cover.xml', format: null },
        })
      )
    ).toEqual({ command: 'make cover', report: 'cover.xml', format: 'infer' });
    expect(
      createCoverageDraft(
        createRepo({
          id: 'web',
          coverage: { mode: 'custom', command: 'make', report: 'r.txt', format: 'go' },
        })
      ).format
    ).toBe('go');
  });

  it('names the format it would infer from the report path', () => {
    expect(describeInferredFormat('')).toBe('Infer from the path');
    expect(describeInferredFormat('coverage/lcov.info')).toBe('Infer from the path: LCOV');
    expect(describeInferredFormat('report.txt')).toBe('Infer from the path: unknown');
    expect(listFormatChoices('coverage.xml').map((choice) => choice.label)).toEqual([
      'Infer from the path: Cobertura XML',
      'LCOV',
      'Cobertura XML',
      'Go cover profile',
    ]);
  });

  it('asks for a command, a report inside the repository and a format it can read', () => {
    expect(validateCoverageDraft({ command: ' ', report: '', format: 'infer' }).errors).toEqual({
      command: 'Give the command that writes the report.',
      report: 'Give the path of the report the command writes.',
    });
    for (const report of ['/tmp/lcov.info', 'C:\\lcov.info', '../lcov.info']) {
      expect(validateCoverageDraft({ command: 'make', report, format: 'lcov' }).errors.report).toBe(
        'Give a path inside the repository, such as coverage/lcov.info.'
      );
    }
    expect(validateCoverageDraft({ command: 'make', report: 'out.txt', format: 'infer' }).errors).toEqual({
      format: 'Shinsa cannot tell the format from the path. Choose one.',
    });
    expect(validateCoverageDraft({ command: 'make', report: 'out.txt', format: 'go' })).toEqual({
      ok: true,
      errors: {},
    });
    expect(resolveDraftCoverage({ command: ' make ', report: ' cover.xml ', format: 'infer' })).toEqual({
      mode: 'custom',
      command: 'make',
      report: 'cover.xml',
      format: null,
    });
    expect(resolveDraftCoverage({ command: 'make', report: 'r.txt', format: 'go' })).toMatchObject({
      format: 'go',
    });
  });
});

describe('coverage of the change', () => {
  it('sums up the changed lines and the files with lines no test runs', () => {
    expect(describeCoverageSummary(createPartialCoverage())).toBe(
      '85% of changed lines are covered (36 of 42) · 2 files have uncovered lines'
    );
    expect(describeCoverageSummary(createFullCoverage())).toBe('All 42 changed lines are covered');
    const one = createPartialCoverage();
    expect(
      describeCoverageSummary({ ...one, files: one.files.slice(1) })?.endsWith('· 1 file has uncovered lines')
    ).toBe(true);
    expect(describeCoverageSummary(UNAVAILABLE)).toBeNull();
    expect(countUncoveredFiles(null)).toBe(0);
  });

  it('gives the Overview a short fact, and nothing when nothing was measured', () => {
    expect(describeCoverageFact(createPartialCoverage())).toBe('85% of changed lines covered');
    expect(describeCoverageFact(createFullCoverage())).toBe('All changed lines covered');
    expect(describeCoverageFact(UNAVAILABLE)).toBeNull();
    expect(describeCoverageFact(undefined)).toBeNull();
  });

  it('counts each file’s lines and names the toggle for the list', () => {
    const [partial, , full] = createPartialCoverage().files;
    expect(describeFileCoverage(partial as CoverageFile)).toBe('10 of 14 lines');
    expect(describeFileCoverage({ covered: 1, executable: 1 })).toBe('1 of 1 line');
    expect(isFileCovered(partial as CoverageFile)).toBe(false);
    expect(isFileCovered(full as CoverageFile)).toBe(true);
    expect(describeFilesToggle({ files: [] }, false)).toBe('Show 0 files');
    expect(describeRangeLabel([40, 42])).toBe('40–42');
    expect(describeRangeLabel([57, 57])).toBe('57');
    expect(describeFilesToggle(createFullCoverage(), true)).toBe('Hide 1 file');
  });
});
