import { describe, expect, test } from 'bun:test';
import {
  resolveAllowedHosts,
  resolveBodyRefusal,
  resolveBodySizeRefusal,
  resolveRefusal,
  resolveUpgradeRefusal,
} from '../../src/http/index.ts';

const allowed = resolveAllowedHosts(['localhost', '127.0.0.1', '[::1]', 'Box.Tail.Net', 'bad host']);

function request(headers: Record<string, string>, method = 'GET') {
  return new Request('http://127.0.0.1:5180/api/queue', { method, headers });
}

describe('resolveRefusal', () => {
  test('answers only on its own names, so a rebound DNS name cannot reach it', () => {
    expect(resolveRefusal(request({ host: '127.0.0.1:5180' }), allowed)).toBeNull();
    expect(resolveRefusal(request({ host: 'localhost:5191' }), allowed)).toBeNull();
    expect(resolveRefusal(request({ host: '[::1]:5180' }), allowed)).toBeNull();
    expect(resolveRefusal(request({ host: 'box.tail.net' }), allowed)).toBeNull();
    expect(resolveRefusal(request({ host: 'evil.example:5180' }), allowed)).toBe(
      'Shinsa only answers on its own address.'
    );
    expect(resolveRefusal(request({ host: '' }), allowed)).toBe('Shinsa only answers on its own address.');
    expect(resolveRefusal(request({ host: 'a b' }), allowed)).toBe('Shinsa only answers on its own address.');
  });

  test('refuses requests a page on another site makes', () => {
    const local = { host: '127.0.0.1:5180' };
    expect(resolveRefusal(request({ ...local, origin: 'http://localhost:5191' }), allowed)).toBeNull();
    expect(resolveRefusal(request({ ...local, origin: 'https://evil.example' }), allowed)).toBe(
      'Requests from other sites are not allowed.'
    );
    expect(resolveRefusal(request({ ...local, origin: 'null' }), allowed)).toBe(
      'Requests from other sites are not allowed.'
    );
    expect(resolveRefusal(request({ ...local, 'sec-fetch-site': 'cross-site' }), allowed)).toBe(
      'Requests from other sites are not allowed.'
    );
    expect(resolveRefusal(request({ ...local, 'sec-fetch-site': 'same-origin' }), allowed)).toBeNull();
  });
});

describe('resolveBodyRefusal', () => {
  test('a write must be JSON, so a cross-site form or text/plain post cannot be simple', () => {
    expect(resolveBodyRefusal(request({}))).toBeNull();
    expect(resolveBodyRefusal(request({}, 'HEAD'))).toBeNull();
    expect(
      resolveBodyRefusal(request({ 'content-type': 'application/json; charset=utf-8' }, 'POST'))
    ).toBeNull();
    expect(resolveBodyRefusal(request({ 'content-type': 'text/plain' }, 'POST'))).toBe(
      'Send the request body as application/json.'
    );
    expect(resolveBodyRefusal(request({}, 'POST'))).toBe('Send the request body as application/json.');
  });
});

describe('resolveUpgradeRefusal', () => {
  test('a WebSocket needs an Origin to check', () => {
    expect(resolveUpgradeRefusal(request({}))).toBe('A WebSocket needs an Origin header.');
    expect(resolveUpgradeRefusal(request({ origin: 'http://localhost:5180' }))).toBeNull();
  });
});

describe('resolveBodySizeRefusal', () => {
  test('refuses a declared length over the limit and takes one at it or without one', () => {
    expect(resolveBodySizeRefusal(request({}), 8)).toBeNull();
    expect(resolveBodySizeRefusal(request({ 'content-length': '8' }), 8)).toBeNull();
    expect(
      resolveBodySizeRefusal(request({ 'content-length': String(40 * 1024 * 1024) }), 33 * 1024 * 1024)
    ).toBe('The request body is over 33 MB.');
  });
});
