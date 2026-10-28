import { describe, expect, it } from 'bun:test';
import { describeServer, parseHealth, parseHealthText } from '../../src/lib/health.ts';

describe('parseHealth', () => {
  it('reads the version when the server reports one', () => {
    expect(parseHealth({ ok: true, seq: 4, problems: [], version: '0.4.0', pid: 12 })).toEqual({
      version: '0.4.0',
    });
  });

  it('answers without a version from a server that has none, or a log with damaged entries', () => {
    expect(parseHealth({ ok: false, seq: 4, problems: [{ seq: 1 }] })).toEqual({ version: null });
    expect(parseHealth({ ok: true, version: '' })).toEqual({ version: null });
  });

  it('refuses an answer that is not Shinsa’s', () => {
    expect(parseHealth(null)).toBeNull();
    expect(parseHealth('ok')).toBeNull();
    expect(parseHealth({ status: 'ok' })).toBeNull();
  });

  it('takes only its own flavor’s engine, so Shinsa never shows Shinsa Canary’s and back', () => {
    expect(parseHealth({ ok: true, version: '1.0.0', flavor: 'stable' })).toEqual({ version: '1.0.0' });
    expect(parseHealth({ ok: true, version: '1.0.1-canary.2', flavor: 'canary' })).toBeNull();
    expect(parseHealth({ ok: true, flavor: 'canary' }, 'canary')).toEqual({ version: null });
    expect(parseHealth({ ok: true, version: '1.0.0' }, 'canary')).toBeNull();
    expect(parseHealthText('{"ok":true,"flavor":"canary"}', 'canary')).toEqual({ version: null });
  });
});

describe('parseHealthText', () => {
  it('reads the health from the response body, and nothing from a body that is not JSON', () => {
    expect(parseHealthText('{"ok":true,"version":"0.4.0"}')).toEqual({ version: '0.4.0' });
    expect(parseHealthText('<html>')).toBeNull();
  });
});

describe('describeServer', () => {
  it('names the server the window shows', () => {
    expect(describeServer('http://127.0.0.1:5180', { version: '0.4.0' })).toBe(
      'Shinsa 0.4.0 at http://127.0.0.1:5180'
    );
    expect(describeServer('http://127.0.0.1:5180', { version: null })).toBe(
      'Shinsa at http://127.0.0.1:5180'
    );
    expect(describeServer('http://127.0.0.1:5180', null)).toBe('Shinsa at http://127.0.0.1:5180');
    expect(describeServer('http://127.0.0.1:5190', { version: '1.0.1-canary.2' }, 'Shinsa Canary')).toBe(
      'Shinsa Canary 1.0.1-canary.2 at http://127.0.0.1:5190'
    );
  });
});
