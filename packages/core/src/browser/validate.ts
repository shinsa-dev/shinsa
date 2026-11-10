import { HandOverReader, type Validation } from '../report/reading.ts';
import { type BrowserSignInRequest, BrowserSignInInput } from './schema.ts';

export function validateBrowserSignInRequest(
  input: Record<string, unknown>
): Validation<BrowserSignInRequest> {
  const reader = new HandOverReader();
  return reader.result(reader.read(BrowserSignInInput, input, []));
}
