import { DomainError } from '@shinsa/core';
import { type JsonObject, readJsonObject } from '../http/body.ts';
import type { ApiRoute } from '../http/routes.ts';
import type { Accounts } from './index.ts';

function readAccountId(fields: JsonObject) {
  const id = fields.accountId;
  if (id === undefined || id === null) return null;
  if (typeof id !== 'string' || !id)
    throw new DomainError('account_invalid', 'Name the account to sign in to.');
  return id;
}

export function createAccountRoutes(accounts: Accounts): ApiRoute[] {
  const post = (path: string, act: (fields: JsonObject) => unknown): ApiRoute => ({
    method: 'POST',
    pattern: new RegExp(`^/api/accounts${path}$`),
    respond: async (_match, request) => Response.json(await act(await readJsonObject(request))),
  });
  return [
    {
      method: 'GET',
      pattern: /^\/api\/accounts$/,
      respond: () => Promise.resolve(Response.json(accounts.snapshot())),
    },
    post('/refresh', (fields) => (fields.scope === 'usage' ? accounts.refreshUsage() : accounts.refresh())),
    post('/login', (fields) => accounts.startLogin(readAccountId(fields))),
    post('/login/code', (fields) => accounts.submitLoginCode(fields.loginId, fields.code)),
    post('/login/cancel', (fields) => accounts.cancelLogin(fields.loginId)),
    post('/import', (fields) => accounts.importAccount(fields.origin, fields.email)),
    post('/update', (fields) => accounts.update(fields.accountId, fields.patch)),
    post('/remove', (fields) => accounts.remove(fields.accountId)),
  ];
}
