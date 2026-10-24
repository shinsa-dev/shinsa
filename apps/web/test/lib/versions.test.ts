import { describe, expect, it } from 'bun:test';
import {
  describeProgramRow,
  describeSdkRow,
  describeUpdateHint,
  describeUpdater,
  describeUpdating,
  listVersionEntries,
  selectProgram,
} from '@/lib/versions.ts';
import { createProgram, createVersions } from '../support/versions.ts';

describe('a program’s row', () => {
  it('shows its version, the latest and the minimum, and offers Update when it is behind', () => {
    expect(describeProgramRow(createProgram())).toEqual({
      title: 'Claude Code',
      version: '2.1.287',
      status: { label: 'Update available', tone: 'blue' },
      detail: 'Latest 2.1.310 · Shinsa needs 2.1.280 or newer',
      canUpdate: true,
      updating: false,
    });
    expect(describeProgramRow(createProgram({ status: 'outdated', latest: null }))).toMatchObject({
      status: { label: 'Update needed', tone: 'orange' },
      detail: 'Shinsa needs 2.1.280 or newer',
      canUpdate: true,
    });
  });

  it('an update in flight, here or on the server, cannot be started again', () => {
    expect(describeProgramRow(createProgram(), true)).toMatchObject({ canUpdate: false, updating: true });
    expect(describeProgramRow(createProgram({ updating: true }))).toMatchObject({
      canUpdate: false,
      updating: true,
    });
  });

  it('says when it is missing, set by an override or unreadable, and says nothing when it is current', () => {
    const status = (patch: Parameters<typeof createProgram>[0]) =>
      describeProgramRow(createProgram(patch)).status;
    expect(status({ status: 'not_installed' })).toEqual({ label: 'Not installed', tone: 'neutral' });
    expect(status({ status: 'unknown', override: '/wrap' })).toEqual({
      label: 'Set by CLAUDE_EXECUTABLE',
      tone: 'neutral',
    });
    expect(status({ id: 'codex', status: 'unknown', override: '/wrap' })?.label).toBe(
      'Set by CODEX_EXECUTABLE'
    );
    expect(status({ status: 'unknown' })?.label).toBe('Couldn’t read the version');
    expect(status({ status: 'current' })).toBeNull();
    expect(describeProgramRow(createProgram({ status: 'current' })).canUpdate).toBe(false);
  });
});

describe('the Agent SDK’s row', () => {
  it('is information only: its version, the latest and the Claude Code it pairs with', () => {
    const { sdk } = createVersions();
    expect(describeSdkRow(sdk)).toEqual({
      title: 'Claude Agent SDK',
      version: '0.3.280',
      status: { label: 'Newer version published', tone: 'neutral' },
      detail: 'Latest 0.3.310 · Pairs with Claude Code 2.1.280',
      canUpdate: false,
      updating: false,
    });
    expect(describeSdkRow({ ...sdk, latest: null })).toMatchObject({
      status: null,
      detail: 'Pairs with Claude Code 2.1.280',
    });
    expect(describeSdkRow({ ...sdk, latest: '0.3.280' }).status).toBeNull();
  });
});

describe('update labels', () => {
  it('names the program, its updater and what an update would do', () => {
    const snapshot = createVersions();
    expect(selectProgram(snapshot, 'codex')?.label).toBe('Codex');
    expect(selectProgram(null, 'codex')).toBeNull();
    expect(describeUpdating('codex')).toBe('Updating Codex');
    expect(describeUpdater('claude update')).toBe('Running claude update.');
    expect(describeUpdater(null)).toBe('Starting the update.');
    expect(describeUpdateHint(null)).toBeUndefined();
    expect(describeUpdateHint(createProgram())).toBe('2.1.287 → 2.1.310');
    expect(describeUpdateHint(createProgram({ updating: true }))).toBe('Updating…');
    expect(describeUpdateHint(createProgram({ status: 'current' }))).toBe('Up to date');
    expect(describeUpdateHint(createProgram({ status: 'outdated', latest: null }))).toBeUndefined();
  });
});

describe('the order of the versions', () => {
  const order = (snapshot: ReturnType<typeof createVersions>) =>
    listVersionEntries(snapshot).map((entry) => (entry.kind === 'sdk' ? 'sdk' : entry.program.id));

  it('puts the Agent SDK right under Claude Code, before Codex', () => {
    expect(order(createVersions())).toEqual(['claude', 'sdk', 'codex']);
  });

  it('keeps it under Claude Code wherever Claude Code is listed', () => {
    const [claude, codex] = createVersions().programs;
    expect(order(createVersions({ programs: [codex!, claude!] }))).toEqual(['codex', 'claude', 'sdk']);
  });

  it('lists it last when Claude Code is not listed', () => {
    const [, codex] = createVersions().programs;
    expect(order(createVersions({ programs: [codex!] }))).toEqual(['codex', 'sdk']);
  });
});
