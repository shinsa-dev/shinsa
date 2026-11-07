import { BunRuntime } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';
import { JsonFile } from '../apps/engine/src/files/service.ts';
import { TerminalFiles } from '../apps/engine/src/terminals/store/service.ts';
import { CommandLayer } from './kit/command/index.ts';
import { reportFailure } from './kit/script.ts';
import { seed } from './seed/index.ts';

const SeedLayer = TerminalFiles.layer.pipe(Layer.provide(JsonFile.layer), Layer.provideMerge(CommandLayer));

seed().pipe(reportFailure, Effect.provide(SeedLayer), BunRuntime.runMain({ disableErrorReporting: true }));
