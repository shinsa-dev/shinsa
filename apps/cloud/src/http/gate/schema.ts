import type { BodyInvalid, BodyTooLarge, ContentTypeInvalid, NotFound } from '@shinsa/core/remote/errors';
import type { Types } from 'effect';

export type GateError = BodyInvalid | BodyTooLarge | ContentTypeInvalid | NotFound | Types.unhandled;

export const JSON_CONTENT_TYPE = 'application/json';
