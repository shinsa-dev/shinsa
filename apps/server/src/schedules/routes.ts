import { DomainError, type ShinsaState } from '@shinsa/core';
import { type JsonObject, readJsonObject } from '../http/body.ts';
import type { ApiRoute } from '../http/routes.ts';
import type { Engine } from '../runtime/engine.ts';
import type { SecretStore } from '../secrets/index.ts';
import { findHookUrl, type ScheduleToolContext } from './tools.ts';

const MAX_SECRET = 10_000;

function readSecret(fields: JsonObject, key: string) {
  const value = fields[key];
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SECRET) {
    throw new DomainError('secret_invalid', `Paste the secret: 1 to ${MAX_SECRET} characters.`);
  }
  return value;
}

function findWebhook(state: ShinsaState, scheduleId: string) {
  const schedule = state.schedules[scheduleId];
  if (schedule?.trigger.kind !== 'webhook') {
    throw new DomainError('schedule_not_found', 'This schedule has no webhook.');
  }
  return { schedule, trigger: schedule.trigger };
}

function findSecretGate(state: ShinsaState, gateId: string) {
  const gate = state.gates[gateId];
  if (!gate?.secret) throw new DomainError('gate_not_found', 'No secret was asked for here.');
  if (gate.status !== 'open') throw new DomainError('gate_closed', 'This has already been answered.');
  return gate;
}

export function createScheduleRoutes(
  engine: Engine,
  secrets: SecretStore,
  context: ScheduleToolContext
): ApiRoute[] {
  function serializeWebhook(scheduleId: string) {
    const { trigger } = findWebhook(engine.state, scheduleId);
    return Response.json({
      url: findHookUrl(context, scheduleId),
      signature: trigger.signature,
      hasSecret: Boolean(secrets.selectHook(scheduleId)?.secret),
      replayKey: trigger.replayKey,
    });
  }

  async function writeWebhookSecret(scheduleId: string, request: Request) {
    findWebhook(engine.state, scheduleId);
    const fields = await readJsonObject(request);
    secrets.writeHookSecret(scheduleId, fields.secret === null ? null : readSecret(fields, 'secret'));
    return serializeWebhook(scheduleId);
  }

  async function answerSecret(gateId: string, request: Request) {
    const gate = findSecretGate(engine.state, gateId);
    const fields = await readJsonObject(request);
    if (fields.decline === true) {
      await engine.dispatch(
        { type: 'gate.answer', gateId, decision: 'reject', response: null },
        { id: `secret:${gateId}:declined` }
      );
      return Response.json({ ok: true });
    }
    const ref = secrets.writeRef(gateId, gate.taskId, readSecret(fields, 'value'));
    try {
      await engine.dispatch(
        { type: 'gate.answer', gateId, decision: 'answer', response: ref },
        { id: `secret:${gateId}:saved` }
      );
    } catch (error) {
      secrets.removeRef(ref, gate.taskId);
      throw error;
    }
    return Response.json({ ok: true });
  }

  return [
    {
      method: 'GET',
      pattern: /^\/api\/schedules\/([^/]+)\/webhook$/,
      respond: ([, id = '']) => Promise.resolve(serializeWebhook(decodeURIComponent(id))),
    },
    {
      method: 'POST',
      pattern: /^\/api\/schedules\/([^/]+)\/webhook$/,
      respond: ([, id = ''], request) => writeWebhookSecret(decodeURIComponent(id), request),
    },
    {
      method: 'POST',
      pattern: /^\/api\/secrets\/([^/]+)$/,
      respond: ([, id = ''], request) => answerSecret(decodeURIComponent(id), request),
    },
  ];
}
