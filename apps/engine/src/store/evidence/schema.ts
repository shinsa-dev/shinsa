import { Schema } from 'effect';

export const EVIDENCE_ROUTE = '/api/evidence/';

export const EVIDENCE_COPY_LIMIT_BYTES = 200 * 1024 * 1024;

export const EvidenceSegment = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][\w-]*(?:\.[\w-]+)*$/));

export const RoundSegment = Schema.String.check(Schema.isPattern(/^round-\d+$/));

export const SLUG_LIMIT = 48;

export const NAME_ID_LENGTH = 12;

export const MEGABYTE = 1024 * 1024;

export interface EvidenceFolder {
  taskId: string;
  round: number;
}

export type TextExtension = 'txt' | 'md';

export class EvidenceFolderInvalid extends Schema.TaggedError<
  EvidenceFolderInvalid,
  { readonly brand: unique symbol }
>()('EvidenceFolderInvalid', { taskId: Schema.String, message: Schema.String }) {}

export class EvidenceSourceMissing extends Schema.TaggedError<
  EvidenceSourceMissing,
  { readonly brand: unique symbol }
>()('EvidenceSourceMissing', { source: Schema.String, message: Schema.String }) {}

export class EvidenceTooLarge extends Schema.TaggedError<
  EvidenceTooLarge,
  { readonly brand: unique symbol }
>()('EvidenceTooLarge', { source: Schema.String, size: Schema.Number, message: Schema.String }) {}
