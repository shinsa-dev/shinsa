import { Context, Duration, Schedule, Schema, SchemaTransformation, type Scope } from 'effect';

export const BrowserProfile = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9_-]{1,80}$/)).pipe(
  Schema.brand('BrowserProfile')
);
export type BrowserProfile = typeof BrowserProfile.Type;

export const SignInUrl = Schema.String.check(Schema.isPattern(/^https?:\/\/[^\s]+$/)).pipe(
  Schema.brand('SignInUrl')
);
export type SignInUrl = typeof SignInUrl.Type;

export const BrowserMode = Schema.Literals(['stopped', 'headless', 'window']);
export type BrowserMode = typeof BrowserMode.Type;

export const BrowserUnavailableReason = Schema.Literals(['not_installed', 'launch_failed', 'signing_in']);
export type BrowserUnavailableReason = typeof BrowserUnavailableReason.Type;

export class BrowserUnavailable extends Schema.TaggedError<
  BrowserUnavailable,
  { readonly brand: unique symbol }
>()('BrowserUnavailable', { reason: BrowserUnavailableReason, message: Schema.String }) {}

export const DevToolsActivePort = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Struct({ port: Schema.NumberFromString, path: Schema.String.check(Schema.isPattern(/^\/\S+$/)) }),
    SchemaTransformation.transform({
      decode: (text: string) => {
        const [port = '', path = ''] = text.trim().split('\n');
        return { port, path };
      },
      encode: ({ port, path }: { readonly port: string; readonly path: string }) => `${port}\n${path}`,
    })
  )
);

export interface BrowserEndpoint {
  readonly webSocketUrl: string;
}

export interface RunningBrowser {
  readonly mode: 'headless' | 'window';
  readonly generation: number;
  readonly scope: Scope.Closeable;
  readonly webSocketUrl: string | null;
  readonly leases: number;
  readonly uses: number;
}

export interface BrowserHostSettings {
  readonly executables: ReadonlyArray<string>;
  readonly idleAfter: Duration.Input;
  readonly launchTimeout: Duration.Input;
  readonly stopTimeout: Duration.Input;
}

export const CHROME_EXECUTABLES: ReadonlyArray<string> = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
];

export const BrowserHostSettings = Context.Reference<BrowserHostSettings>(
  'shinsa/engine/browser/host/BrowserHostSettings',
  {
    defaultValue: () => ({
      executables: CHROME_EXECUTABLES,
      idleAfter: Duration.minutes(10),
      launchTimeout: Duration.seconds(20),
      stopTimeout: Duration.seconds(10),
    }),
  }
);

export const BROWSER_DIR = 'browser';

export const ACTIVE_PORT_FILE = 'DevToolsActivePort';

export const SHARED_ARGS: ReadonlyArray<string> = [
  '--use-mock-keychain',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=ChromeWhatsNewUI',
];

export const HEADLESS_ARGS: ReadonlyArray<string> = [
  '--headless=new',
  '--remote-debugging-address=127.0.0.1',
  '--remote-debugging-port=0',
  '--force-device-scale-factor=2',
  'about:blank',
];

export const LAUNCH_POLL = Schedule.spaced(Duration.millis(100));

export const NOT_INSTALLED_MESSAGE =
  'Google Chrome is not installed, so agents have no shared browser. Install it from google.com/chrome.';

export const NOT_READY_MESSAGE = 'Chrome did not start in time.';

export const SIGNING_IN_MESSAGE =
  "This project's browser is open for signing in. Try again once the sign-in window is closed.";
