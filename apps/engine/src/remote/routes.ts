import { DomainError } from '@shinsa/core';
import { type JsonObject, readJsonObject } from '../http/body.ts';
import type { ApiRoute } from '../http/routes.ts';
import type { Remote } from './index.ts';

function readText(fields: JsonObject, name: string, message: string) {
  const value = fields[name];
  if (typeof value !== 'string' || !value.trim()) throw new DomainError(`${name}_invalid`, message);
  return value;
}

export function createRemoteRoutes(remote: Remote): ApiRoute[] {
  const post = (path: string, act: (fields: JsonObject) => unknown): ApiRoute => ({
    method: 'POST',
    pattern: new RegExp(`^/api/remote${path}$`),
    respond: async (_match, request) => {
      const fields = await readJsonObject(request);
      const result = await act(fields);
      return Response.json(result ?? remote.snapshot());
    },
  });
  return [
    {
      method: 'GET',
      pattern: /^\/api\/remote$/,
      respond: () => Promise.resolve(Response.json(remote.snapshot())),
    },
    post('/pair', async () => {
      await remote.startPairing();
    }),
    post('/pair/cancel', () => {
      remote.cancelPairing();
    }),
    post('/enable', () => {
      remote.enable();
    }),
    post('/disable', () => remote.disable()),
    post('/remove', () => remote.remove()),
    post('/link/create', () => remote.createLink()),
    post('/link/remove', () => remote.removeLink()),
    post('/requests/accept', async (fields) => {
      await remote.acceptRequest(readText(fields, 'requestId', 'Name the access request to accept.'));
    }),
    post('/requests/decline', (fields) => {
      remote.declineRequest(readText(fields, 'requestId', 'Name the access request to decline.'));
    }),
    post('/members/remove', async (fields) => {
      await remote.removeMember(readText(fields, 'userId', 'Name the member to remove by their GitHub id.'));
    }),
    post('/devices/remove', (fields) => {
      const publicKey = readText(fields, 'publicKey', 'Name the device to remove by its key.');
      if (!remote.removeDevice(publicKey))
        throw new DomainError('device_not_found', 'No device with that key is enrolled.');
    }),
  ];
}
