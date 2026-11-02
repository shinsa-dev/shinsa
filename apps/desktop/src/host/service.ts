import { Context } from 'effect';

export class DesktopHost extends Context.Service<
  DesktopHost,
  {
    readonly packaged: boolean;
    readonly home: string;
    readonly uid: number;
    readonly resourcesPath: string;
    readonly env: Readonly<Record<string, string | undefined>>;
  }
>()('shinsa/desktop/host/DesktopHost') {}
