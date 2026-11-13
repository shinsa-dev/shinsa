import { Cause, Effect, Fiber, Layer, Option } from 'effect';
import { UsageResume } from '../accounts/index.ts';
import { Accounts } from '../accounts/roster/service.ts';
import { RunSupervisor, Transcripts, watchSilence } from '../agents/index.ts';
import { BriefingWriter } from '../briefing/service.ts';
import { EngineConfig } from '../config/service.ts';
import { EunoeServer } from '../eunoe/service.ts';
import { Extensions } from '../extensions/registry/service.ts';
import { EngineServer } from '../http/server/service.ts';
import { LeadWakes } from '../initiatives/service.ts';
import { TeamMembers } from '../initiatives/team-members/service.ts';
import { ServeLock } from '../instance/lock/service.ts';
import { describeError } from '../log/redact.ts';
import { Remote, TeamFeeds } from '../remote/index.ts';
import { ShareClock } from '../remote/share-clock/service.ts';
import { AutopilotClock } from '../runtime/autopilot/service.ts';
import { EffectRunner } from '../runtime/effects/service.ts';
import { EngineCore } from '../runtime/engine/service.ts';
import { MonitorClock } from '../runtime/monitors/service.ts';
import { WatchdogClock } from '../runtime/watchdogs/service.ts';
import { Schedules } from '../schedules/service.ts';
import { Slack } from '../slack/service.ts';
import { TaskRetry } from '../tasks/index.ts';
import { Terminals } from '../terminals/service.ts';
import { MessageInbox } from '../triage/index.ts';
import { Versions } from '../versions/service.ts';
import { ServerAddress } from './address/service.ts';

export const WorkLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* EngineConfig;
    const engine = yield* EngineCore;
    const server = yield* EngineServer;
    const effects = yield* EffectRunner;
    const accounts = yield* Accounts;
    const usageResume = yield* UsageResume;
    const runs = yield* RunSupervisor;
    const transcripts = yield* Transcripts;
    const briefings = yield* BriefingWriter;
    const leads = yield* LeadWakes;
    const teamMembers = yield* TeamMembers;
    const inbox = yield* MessageInbox;
    const schedules = yield* Schedules;
    const slack = yield* Slack;
    const versions = yield* Versions;
    const remote = yield* Remote;
    const teamFeeds = yield* TeamFeeds;
    const terminals = yield* Terminals;
    const extensions = yield* Extensions;
    const eunoe = yield* EunoeServer;
    const clocks = [
      yield* MonitorClock,
      yield* WatchdogClock,
      yield* AutopilotClock,
      yield* ShareClock,
      yield* TaskRetry,
    ];
    const lock = yield* Effect.serviceOption(ServeLock);
    if (Option.isSome(lock)) yield* lock.value.update({ port: server.port, url: server.url });
    yield* (yield* ServerAddress).replace(server.url);
    yield* terminals.resumeServices(yield* engine.state);

    let checking: Fiber.Fiber<void> | null = null;
    yield* Effect.addFinalizer(() => (checking ? Fiber.await(checking) : Effect.void));
    yield* Effect.addFinalizer(() => eunoe.stop);
    const stopWork = Effect.gen(function* () {
      yield* runs.interruptForShutdown;
      yield* briefings.stop;
      yield* leads.stop;
      yield* inbox.stop;
      yield* schedules.stop;
      yield* slack.stop;
      yield* accounts.stop;
      yield* usageResume.stop;
      yield* versions.stop;
      yield* teamFeeds.stop;
      yield* remote.stop;
      yield* terminals.stop;
      for (const clock of clocks) yield* clock.stop;
      yield* effects.stop;
      yield* Effect.logInfo('[Serve] Stopped the pull request syncs');
      yield* extensions.stop;
      yield* engine.stop;
      yield* Effect.logInfo('[Serve] Stopped the running effects');
      yield* engine.settle;
      yield* Effect.logInfo('[Serve] Every running effect has settled');
    });
    yield* Effect.addFinalizer(() => stopWork);

    if (config.inspect) {
      yield* Effect.logInfo('[Serve] Inspect mode: agents, pull request sync and recovery are off').pipe(
        Effect.annotateLogs({ dataDir: config.dataDir })
      );
      return;
    }
    yield* engine.start;
    yield* engine
      .dispatch({ type: 'clock.record', timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })
      .pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning('[Serve] Could not record the time zone of this Mac').pipe(
            Effect.annotateLogs({ error: describeError(Cause.squash(cause)) })
          )
        )
      );
    yield* effects.startWatching;
    yield* schedules.start;
    for (const clock of clocks) yield* clock.start;
    yield* watchSilence(engine, transcripts);
    yield* usageResume.start;
    checking = yield* Effect.forkDetach(
      accounts.start.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning('[Serve] Could not check the Claude accounts').pipe(
            Effect.annotateLogs({ error: describeError(Cause.squash(cause)) })
          )
        )
      )
    );
    yield* runs.recover.pipe(Effect.orDie);
    yield* effects.recover.pipe(Effect.orDie);
    yield* inbox.start;
    yield* remote.start;
    yield* Effect.forkDetach(slack.start);
    yield* teamFeeds.start;
    yield* teamMembers.start;
    yield* briefings.schedule;
    yield* leads.recover;
    yield* extensions.syncSnapshot;
    yield* Effect.forkDetach(extensions.syncUsage);
    yield* Effect.logInfo('[Serve] Ready').pipe(
      Effect.annotateLogs({ dataDir: config.dataDir, events: (yield* engine.state).seq })
    );
  })
);
