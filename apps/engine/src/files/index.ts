import { Effect, Option, type Schema } from 'effect';
import { edgeRuntime } from '../runtime/edge.ts';
import type { JsonFileRead } from './schema.ts';
import { JsonFile } from './service.ts';

export function writeJsonFile(path: string, value: unknown) {
  edgeRuntime.runSync(JsonFile.use((file) => file.write(path, value)));
}

export function keepJsonFileAside(path: string) {
  return edgeRuntime.runSync(JsonFile.use((file) => file.keepAside(path)));
}

export function readJsonFile<A>(path: string, schema: Schema.Decoder<A>): JsonFileRead<A> {
  return edgeRuntime.runSync(
    JsonFile.use((file) => file.read(path, schema)).pipe(
      Effect.match({
        onFailure: (error) => ({ value: null, problem: error.reason }),
        onSuccess: (value) => ({ value: Option.getOrNull(value), problem: null }),
      })
    )
  );
}
