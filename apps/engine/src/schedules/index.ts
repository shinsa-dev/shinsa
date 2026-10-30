import type { StateClockOptions } from '../runtime/clock.ts';
import type { Engine } from '../runtime/engine.ts';
import type { SecretStore } from '../secrets/index.ts';
import { ScheduleClock } from './clock.ts';
import { createScheduleRoutes } from './routes.ts';
import { handleScheduleTool, type ScheduleToolCall, type ScheduleToolContext } from './tools.ts';
import { isWebhookPath, WebhookReceiver } from './webhook.ts';

export type { ScheduleToolCall } from './tools.ts';

export interface SchedulesOptions extends StateClockOptions {
  baseUrl: () => string;
  hookUrl?: (scheduleId: string, token: string) => string | null;
  timeZone?: string;
  newId?: () => string;
}

export class Schedules {
  readonly clock: ScheduleClock;
  readonly context: ScheduleToolContext;
  readonly #receiver: WebhookReceiver;
  readonly #engine: Engine;
  readonly #secrets: SecretStore;
  #unsubscribe: (() => void) | null = null;

  constructor(engine: Engine, secrets: SecretStore, options: SchedulesOptions) {
    const now = options.now ?? Date.now;
    this.#engine = engine;
    this.#secrets = secrets;
    this.clock = new ScheduleClock(engine, options);
    this.#receiver = new WebhookReceiver(engine, secrets, {
      now,
      ...(options.newId ? { newId: options.newId } : {}),
    });
    this.context = {
      secrets,
      baseUrl: options.baseUrl,
      hookUrl: options.hookUrl ?? (() => null),
      timeZone: options.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      now,
    };
  }

  start() {
    this.#secrets.removeExpiredRefs();
    this.#syncHooks();
    this.#unsubscribe ??= this.#engine.subscribe(() => this.#syncHooks());
    this.clock.start();
  }

  stop() {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.clock.stop();
  }

  #syncHooks() {
    const schedules = Object.values(this.#engine.state.schedules);
    for (const schedule of schedules) {
      if (schedule.trigger.kind === 'webhook') this.#secrets.upsertHook(schedule.id);
    }
    this.#secrets.pruneHooks(new Set(schedules.map((schedule) => schedule.id)));
  }

  routes() {
    return createScheduleRoutes(this.#engine, this.#secrets, this.context);
  }

  isWebhook(pathname: string) {
    return isWebhookPath(pathname);
  }

  handleWebhook(request: Request, url: URL) {
    return this.#receiver.handle(request, url);
  }

  handleTool(name: string, input: Record<string, unknown>, call: ScheduleToolCall) {
    return handleScheduleTool(name, input, call, this.context);
  }
}
