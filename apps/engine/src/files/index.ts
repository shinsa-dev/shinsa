import { edgeRuntime } from '../runtime/edge.ts';
import { JsonFile } from './service.ts';

export function writeJsonFile(path: string, value: unknown) {
  edgeRuntime.runSync(JsonFile.use((file) => file.write(path, value)));
}

export function keepJsonFileAside(path: string) {
  return edgeRuntime.runSync(JsonFile.use((file) => file.keepAside(path)));
}
