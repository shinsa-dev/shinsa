import { randomBytes } from 'node:crypto';
import {
  parseScheduleFilter,
  SCHEDULE_FILTER_SCHEMA,
  SCHEDULE_FILTER_SYSTEM,
  type Schedule,
  type ScheduleFilterSubject,
  serializeScheduleFilterPrompt,
} from '@shinsa/core';
import { Context, Effect, Layer, Option } from 'effect';
import { QuickCalls } from '../../agents/quick/service.ts';
import { FRAME_ID_BYTES } from '../schema.ts';
import { FILTER_SUBJECT_LIMIT, FILTER_TIMEOUT } from './schema.ts';

export class ScheduleFilter extends Context.Service<
  ScheduleFilter,
  { readonly applies: (schedule: Schedule, subject: ScheduleFilterSubject) => Effect.Effect<boolean> }
>()('shinsa/engine/schedules/filter/ScheduleFilter') {
  static readonly layer = Layer.effect(
    ScheduleFilter,
    Effect.gen(function* () {
      const quick = yield* QuickCalls;

      const applies = Effect.fn('ScheduleFilter.applies')(function* (
        schedule: Schedule,
        subject: ScheduleFilterSubject
      ) {
        if (schedule.source) return true;
        const said = yield* quick
          .classify<unknown>(
            SCHEDULE_FILTER_SYSTEM,
            serializeScheduleFilterPrompt(
              schedule.text,
              { ...subject, body: subject.body.slice(0, FILTER_SUBJECT_LIMIT) },
              randomBytes(FRAME_ID_BYTES).toString('hex')
            ),
            SCHEDULE_FILTER_SCHEMA
          )
          .pipe(Effect.timeoutOption(FILTER_TIMEOUT));
        return !Option.contains(Option.flatMap(said, parseScheduleFilter), 'skip');
      });

      return ScheduleFilter.of({ applies });
    })
  );
}
