import { describe, expect, it } from 'bun:test';
import { parseConfigPort, resolveConfigPath, resolveServerUrl } from '../../src/lib/server-url.ts';

describe('resolveServerUrl', () => {
  it('uses the server on the port the command line uses', () => {
    expect(resolveServerUrl({ env: {}, packaged: true, configPort: null })).toBe('http://127.0.0.1:5180');
    expect(resolveServerUrl({ env: {}, packaged: true, configPort: 5300 })).toBe('http://127.0.0.1:5300');
    expect(resolveServerUrl({ env: { SHINSA_PORT: '5400' }, packaged: true, configPort: 5300 })).toBe(
      'http://127.0.0.1:5400'
    );
    expect(resolveServerUrl({ env: { SHINSA_PORT: 'abc' }, packaged: true, configPort: null })).toBe(
      'http://127.0.0.1:5180'
    );
  });

  it('uses the Vite dev server when unpackaged', () => {
    expect(resolveServerUrl({ env: {}, packaged: false, configPort: 5300 })).toBe('http://127.0.0.1:5181');
  });

  it('takes SHINSA_URL over everything, by its origin', () => {
    expect(
      resolveServerUrl({
        env: { SHINSA_URL: 'http://localhost:5190/tasks' },
        packaged: false,
        configPort: null,
      })
    ).toBe('http://localhost:5190');
    expect(resolveServerUrl({ env: { SHINSA_URL: 'ftp://host' }, packaged: true, configPort: null })).toBe(
      'http://127.0.0.1:5180'
    );
    expect(resolveServerUrl({ env: { SHINSA_URL: 'not a url' }, packaged: true, configPort: null })).toBe(
      'http://127.0.0.1:5180'
    );
  });
});

describe('the config file', () => {
  it('lives where the command line keeps it', () => {
    expect(resolveConfigPath({}, '/Users/me')).toBe('/Users/me/.config/shinsa/config.json');
    expect(resolveConfigPath({ HOME: '/home/me' }, '/Users/me')).toBe('/home/me/.config/shinsa/config.json');
    expect(resolveConfigPath({ XDG_CONFIG_HOME: '/xdg' }, '/Users/me')).toBe('/xdg/shinsa/config.json');
    expect(resolveConfigPath({ SHINSA_DATA_DIR: '/data' }, '/Users/me')).toBe('/data/config.json');
    expect(resolveConfigPath({ SHINSA_HOME: '/shinsa', SHINSA_DATA_DIR: '/data' }, '/Users/me')).toBe(
      '/shinsa/config.json'
    );
  });

  it('reads its port, and nothing that is not one', () => {
    expect(parseConfigPort('{"port":5300}')).toBe(5300);
    expect(parseConfigPort('{"port":"5300"}')).toBe(5300);
    expect(parseConfigPort('{"port":70000}')).toBeNull();
    expect(parseConfigPort('{"port":0}')).toBeNull();
    expect(parseConfigPort('{}')).toBeNull();
    expect(parseConfigPort('null')).toBeNull();
    expect(parseConfigPort('{')).toBeNull();
    expect(parseConfigPort(null)).toBeNull();
  });
});
