import { Context } from 'effect';

export class DesktopHost extends Context.Service<
  DesktopHost,
  {
    readonly packaged: boolean;
    readonly platform: string;
    readonly version: string;
    readonly home: string;
    readonly uid: number;
    readonly resourcesPath: string;
    readonly userDataPath: string;
    readonly logsPath: string;
    readonly env: Readonly<Record<string, string | undefined>>;
  }
>()('shinsa/desktop/host/DesktopHost') {}
