import { describe, expect, it } from 'bun:test';
import { Schema } from 'effect';
import { parseHealth, parseHealthText } from '../../src/server/health.ts';
import { HealthAnswer } from '../../src/server/schema.ts';
import { describeServer } from '../../src/server/url.ts';

describe('parseHealth', () => {
  it('reads the version when the server reports one', () => {
    expect(parseHealth({ ok: true, seq: 4, problems: [], version: '0.4.0', pid: 12 })).toEqual({
      version: '0.4.0',
      working: 0,
      updating: false,
    });
  });

  it('answers without a version from a server that has none, or a log with damaged entries', () => {
    expect(parseHealth({ ok: false, seq: 4, problems: [{ seq: 1 }] })).toEqual({
      version: null,
      working: 0,
      updating: false,
    });
    expect(parseHealth({ ok: true, version: '' })).toEqual({ version: null, working: 0, updating: false });
  });

  it('reads how many agents are working, and none from a count that is not one', () => {
    expect(parseHealth({ ok: true, working: 3, updating: false })).toEqual({
      version: null,
      working: 3,
      updating: false,
    });
    expect(parseHealth({ ok: true, working: -1 })).toEqual({ version: null, working: 0, updating: false });
    expect(parseHealth({ ok: true, working: 1.5 })).toEqual({ version: null, working: 0, updating: false });
    expect(parseHealth({ ok: true, working: '2' })).toEqual({ version: null, working: 0, updating: false });
  });

  it('says when the engine waits for agents to hand over before it moves to a new version', () => {
    expect(parseHealth({ ok: true, working: 2, restart: 'idle' })).toEqual({
      version: null,
      working: 2,
      updating: true,
    });
  });

  it('refuses an answer that is not Shinsa’s', () => {
    expect(parseHealth(null)).toBeNull();
    expect(parseHealth('ok')).toBeNull();
    expect(parseHealth({ status: 'ok' })).toBeNull();
  });

  it('takes an engine on any update channel, since a canary is Shinsa too', () => {
    expect(parseHealth({ ok: true, version: '1.0.1-canary.2' })).toEqual({
      version: '1.0.1-canary.2',
      working: 0,
      updating: false,
    });
  });
});

describe('parseHealthText', () => {
  it('reads the health from the response body, and nothing from a body that is not JSON', () => {
    expect(parseHealthText('{"ok":true,"version":"0.4.0"}')).toEqual({
      version: '0.4.0',
      working: 0,
      updating: false,
    });
    expect(parseHealthText('<html>')).toBeNull();
  });
});

describe('HealthAnswer', () => {
  it('writes a health back as an answer that reads the same', () => {
    for (const health of [
      { version: '0.4.0', working: 2, updating: true },
      { version: null, working: 0, updating: false },
    ]) {
      expect(parseHealth(Schema.encodeSync(HealthAnswer)(health))).toEqual(health);
    }
  });
});

describe('describeServer', () => {
  it('names the server the window shows', () => {
    expect(describeServer('http://127.0.0.1:5180', { version: '0.4.0', working: 0, updating: false })).toBe(
      'Shinsa 0.4.0 at http://127.0.0.1:5180'
    );
    expect(describeServer('http://127.0.0.1:5180', { version: null, working: 0, updating: false })).toBe(
      'Shinsa at http://127.0.0.1:5180'
    );
    expect(describeServer('http://127.0.0.1:5180', null)).toBe('Shinsa at http://127.0.0.1:5180');
  });
});
