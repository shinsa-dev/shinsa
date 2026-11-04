import { Context } from 'effect';
import { resolveBrowserCommand } from '../../shell/browser.ts';

export const BrowserCommand = Context.Reference<(url: string) => string[] | null>(
  'shinsa/engine/remote/opener/BrowserCommand',
  { defaultValue: () => resolveBrowserCommand }
);
