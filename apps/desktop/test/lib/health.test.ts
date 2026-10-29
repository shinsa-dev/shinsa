import { describe, expect, it } from 'bun:test';
import { describeServer, parseHealth, parseHealthText } from '../../src/lib/health.ts';

describe('parseHealth', () => {
  it('reads the version when the server reports one', () => {
    expect(parseHealth({ ok: true, seq: 4, problems: [], version: '0.4.0', pid: 12 })).toEqual({
      version: '0.4.0',
      working: 0,
    });
  });

  it('answers without a version from a server that has none, or a log with damaged entries', () => {
    expect(parseHealth({ ok: false, seq: 4, problems: [{ seq: 1 }] })).toEqual({ version: null, working: 0 });
    expect(parseHealth({ ok: true, version: '' })).toEqual({ version: null, working: 0 });
  });

  it('reads how many agents are working, and none from a count that is not one', () => {
    expect(parseHealth({ ok: true, working: 3 })).toEqual({ version: null, working: 3 });
    expect(parseHealth({ ok: true, working: -1 })).toEqual({ version: null, working: 0 });
    expect(parseHealth({ ok: true, working: 1.5 })).toEqual({ version: null, working: 0 });
    expect(parseHealth({ ok: true, working: '2' })).toEqual({ version: null, working: 0 });
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
    });
  });
});

describe('parseHealthText', () => {
  it('reads the health from the response body, and nothing from a body that is not JSON', () => {
    expect(parseHealthText('{"ok":true,"version":"0.4.0"}')).toEqual({ version: '0.4.0', working: 0 });
    expect(parseHealthText('<html>')).toBeNull();
  });
});

describe('describeServer', () => {
  it('names the server the window shows', () => {
    expect(describeServer('http://127.0.0.1:5180', { version: '0.4.0', working: 0 })).toBe(
      'Shinsa 0.4.0 at http://127.0.0.1:5180'
    );
    expect(describeServer('http://127.0.0.1:5180', { version: null, working: 0 })).toBe(
      'Shinsa at http://127.0.0.1:5180'
    );
    expect(describeServer('http://127.0.0.1:5180', null)).toBe('Shinsa at http://127.0.0.1:5180');
  });
});
