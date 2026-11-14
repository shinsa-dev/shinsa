import { describe, expect, it } from 'bun:test';
import { LOCAL_SOURCE, type SourceSetting } from '../../src/source/schema.ts';
import {
  describeSource,
  listSourceOptions,
  resolveCloudOrigin,
  resolveSourceChoice,
  resolveSourceSwitch,
} from '../../src/source/source.ts';

const STUDIO: SourceSetting = { kind: 'cloud', machine: { id: 'm1', name: 'Studio' } };

const CHOOSER: SourceSetting = { kind: 'cloud', machine: null };

describe('the Shinsa Cloud origin', () => {
  it('is app.shinsa.dev unless SHINSA_CLOUD_URL names another, by its origin', () => {
    expect(resolveCloudOrigin({})).toBe('https://app.shinsa.dev');
    expect(resolveCloudOrigin({ SHINSA_CLOUD_URL: 'http://127.0.0.1:5195/sandbox' })).toBe(
      'http://127.0.0.1:5195'
    );
    expect(resolveCloudOrigin({ SHINSA_CLOUD_URL: 'file:///tmp' })).toBe('https://app.shinsa.dev');
  });
});

describe('switching the engine', () => {
  it('does nothing for the same engine, reloads between machines and relaunches between This Mac and Shinsa Cloud', () => {
    expect(resolveSourceSwitch(LOCAL_SOURCE, LOCAL_SOURCE)).toBe('none');
    expect(resolveSourceSwitch(STUDIO, { kind: 'cloud', machine: { id: 'm1', name: 'Studio' } })).toBe(
      'none'
    );
    expect(resolveSourceSwitch(STUDIO, CHOOSER)).toBe('reload');
    expect(resolveSourceSwitch(STUDIO, { kind: 'cloud', machine: { id: 'm1', name: 'Renamed' } })).toBe(
      'reload'
    );
    expect(resolveSourceSwitch(LOCAL_SOURCE, STUDIO)).toBe('relaunch');
    expect(resolveSourceSwitch(CHOOSER, LOCAL_SOURCE)).toBe('relaunch');
  });

  it('turns a menu choice into the engine it picks', () => {
    expect(resolveSourceChoice(STUDIO, 'local')).toEqual(LOCAL_SOURCE);
    expect(resolveSourceChoice(LOCAL_SOURCE, 'choose')).toEqual(CHOOSER);
    expect(resolveSourceChoice(STUDIO, 'pinned')).toBe(STUDIO);
  });
});

describe('the engine choices', () => {
  it('lists This Mac, the pinned machine and the chooser, checking the one in use', () => {
    expect(listSourceOptions(LOCAL_SOURCE)).toEqual([
      { choice: 'local', label: 'This Mac', checked: true },
      { choice: 'choose', label: 'Choose a Machine…', checked: false },
    ]);
    expect(listSourceOptions(STUDIO)).toEqual([
      { choice: 'local', label: 'This Mac', checked: false },
      { choice: 'pinned', label: 'Studio', checked: true },
      { choice: 'choose', label: 'Choose a Machine…', checked: false },
    ]);
    expect(listSourceOptions(CHOOSER).at(-1)).toEqual({
      choice: 'choose',
      label: 'Choose a Machine…',
      checked: true,
    });
  });

  it('names the engine in use', () => {
    expect(describeSource(LOCAL_SOURCE)).toBe('This Mac');
    expect(describeSource(STUDIO)).toBe('Studio on Shinsa Cloud');
    expect(describeSource(CHOOSER)).toBe('Shinsa Cloud');
  });
});
