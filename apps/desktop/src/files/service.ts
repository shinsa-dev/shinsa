import { Context, type Effect, type Option } from 'effect';
import type { FileWriteFailed } from './schema.ts';

export class Files extends Context.Service<
  Files,
  {
    readText(path: string): Effect.Effect<Option.Option<string>>;
    exists(path: string): Effect.Effect<boolean>;
    writeText(path: string, text: string): Effect.Effect<void, FileWriteFailed>;
    remove(path: string): Effect.Effect<void>;
  }
>()('shinsa/desktop/files/Files') {}
