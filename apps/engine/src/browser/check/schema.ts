import { Context, Duration, Schema } from 'effect';

export interface BrowserSignInCheckSettings {
  readonly poll: Duration.Input;
  readonly settle: Duration.Input;
  readonly cap: Duration.Input;
}

export const BrowserSignInCheckSettings = Context.Reference<BrowserSignInCheckSettings>(
  'shinsa/engine/browser/check/BrowserSignInCheckSettings',
  {
    defaultValue: () => ({
      poll: Duration.millis(250),
      settle: Duration.millis(1_500),
      cap: Duration.seconds(12),
    }),
  }
);

export interface StableUrl {
  readonly url: string;
  readonly since: number;
}

export const CreatedTarget = Schema.Struct({ targetId: Schema.String });

export const PageReading = Schema.Struct({
  result: Schema.Struct({
    value: Schema.Struct({ ready: Schema.String, url: Schema.String }),
  }),
});
export type PageReading = (typeof PageReading.Type)['result']['value'];

export const READ_PAGE_EXPRESSION = '({ ready: document.readyState, url: location.href })';

export const PAGE_LOADED = 'complete';
