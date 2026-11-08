import { writeFileSync } from 'node:fs';

export function writeImageFile(path: string, base64: string) {
  writeFileSync(path, Buffer.from(base64, 'base64'));
}
