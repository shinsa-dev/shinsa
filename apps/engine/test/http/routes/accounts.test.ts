import { afterEach, describe, expect, test } from 'bun:test';
import { DomainError } from '@shinsa/core';
import { Effect } from 'effect';
import type { Accounts } from '../../../src/accounts/index.ts';
import { disposeWebHandlers } from '../../helpers/web.ts';
import { readFailure, startRoutes } from './harness.ts';

afterEach(disposeWebHandlers);

function createAccounts() {
  const calls: [string, ...unknown[]][] = [];
  const answer = (name: string, value: unknown, args: unknown[] = []) =>
    Effect.sync(() => {
      calls.push([name, ...args]);
      return value;
    });
  const record =
    (name: string, value: unknown) =>
    (...args: unknown[]) =>
      answer(name, value, args);
  const accounts = {
    snapshot: answer('snapshot', { accounts: [], defaultAccountId: null }),
    refresh: answer('refresh', { refreshed: true }),
    refreshUsage: answer('refreshUsage', { usageRefreshed: true }),
    startLogin: record('startLogin', { id: 'login-1', phase: 'starting' }),
    submitLoginCode: record('submitLoginCode', { submitted: true }),
    cancelLogin: record('cancelLogin', { cancelled: true }),
    importAccount: record('importAccount', { id: 'acc-2' }),
    update: (...args: unknown[]) =>
      args[0] === 'gone'
        ? Effect.fail(new DomainError({ code: 'account_not_found', message: 'That account was removed.' }))
        : answer('update', { updated: true }, args),
    remove: record('remove', { removed: true }),
  };
  const routes = startRoutes({ accounts: accounts as unknown as Accounts['Service'] });
  const post = async (path: string, body: string) =>
    (
      await routes.send(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    ).json();
  const refuse = async (path: string, body: string) =>
    readFailure(
      await routes.send(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body })
    );
  return { routes, calls, post, refuse };
}

describe('account routes', () => {
  test('GET /api/accounts answers the snapshot', async () => {
    const { routes, calls } = createAccounts();
    const response = await routes.send('/api/accounts');
    expect(await response.json()).toEqual({ accounts: [], defaultAccountId: null });
    expect(calls).toEqual([['snapshot']]);
  });

  test('each POST passes its fields to the accounts and answers with the result', async () => {
    const { post, calls } = createAccounts();
    expect(await post('/api/accounts/refresh', '{}')).toEqual({ refreshed: true });
    expect(await post('/api/accounts/refresh', '{"scope":"usage"}')).toEqual({ usageRefreshed: true });
    expect(await post('/api/accounts/login', '{"accountId":"acc-1"}')).toEqual({
      id: 'login-1',
      phase: 'starting',
    });
    expect(await post('/api/accounts/login/code', '{"loginId":"login-1","code":"abc#def"}')).toEqual({
      submitted: true,
    });
    expect(await post('/api/accounts/login/cancel', '{"loginId":"login-1"}')).toEqual({ cancelled: true });
    expect(await post('/api/accounts/import', '{"origin":"cswap","email":"me@x.dev"}')).toEqual({
      id: 'acc-2',
    });
    expect(await post('/api/accounts/update', '{"accountId":"acc-1","patch":{"paused":true}}')).toEqual({
      updated: true,
    });
    expect(await post('/api/accounts/remove', '{"accountId":"acc-1"}')).toEqual({ removed: true });
    expect(calls).toEqual([
      ['refresh'],
      ['refreshUsage'],
      ['startLogin', 'acc-1'],
      ['submitLoginCode', 'login-1', 'abc#def'],
      ['cancelLogin', 'login-1'],
      ['importAccount', 'cswap', 'me@x.dev'],
      ['update', 'acc-1', { paused: true }],
      ['remove', 'acc-1'],
    ]);
  });

  test('a change the accounts refuse answers with their code and reason', async () => {
    const { refuse } = createAccounts();
    expect(await refuse('/api/accounts/update', '{"accountId":"gone","patch":{}}')).toEqual({
      status: 400,
      code: 'account_not_found',
      message: 'That account was removed.',
    });
  });

  test('signing in without an account adds a new one', async () => {
    const { post, calls } = createAccounts();
    await post('/api/accounts/login', '{}');
    await post('/api/accounts/login', '{"accountId":null}');
    expect(calls).toEqual([
      ['startLogin', null],
      ['startLogin', null],
    ]);
  });

  test('an account id that is empty or not a string is refused', async () => {
    const { refuse, calls } = createAccounts();
    for (const body of ['{"accountId":""}', '{"accountId":7}']) {
      expect(await refuse('/api/accounts/login', body)).toEqual({
        status: 400,
        code: 'account_invalid',
        message: 'Name the account to sign in to.',
      });
    }
    expect(calls).toEqual([]);
  });

  test('a body that is not JSON or not an object is refused before anything runs', async () => {
    const { refuse, calls } = createAccounts();
    expect(await refuse('/api/accounts/refresh', '{')).toEqual({
      status: 400,
      code: 'body_invalid',
      message: 'The request body is not valid JSON.',
    });
    for (const body of ['null', '[1]', '"text"']) {
      expect(await refuse('/api/accounts/remove', body)).toEqual({
        status: 400,
        code: 'body_invalid',
        message: 'The request body must be an object.',
      });
    }
    expect(calls).toEqual([]);
  });

  test('routes match their whole path only, and answer not found without accounts', async () => {
    const { refuse } = createAccounts();
    expect(await refuse('/api/accounts/login/code/extra', '{}')).toMatchObject({
      status: 404,
      code: 'not_found',
    });
    const bare = startRoutes();
    expect(await readFailure(await bare.send('/api/accounts'))).toEqual({
      status: 404,
      code: 'not_found',
      message: 'No such endpoint.',
    });
  });
});
