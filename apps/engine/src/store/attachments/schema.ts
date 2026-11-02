import { Schema } from 'effect';

export const ATTACHMENT_ROUTE = '/api/attachments/';

export const ATTACHMENT_LIMIT_BYTES = 25 * 1024 * 1024;

export const ATTACHMENT_REQUEST_LIMIT_BYTES = Math.ceil((ATTACHMENT_LIMIT_BYTES * 4) / 3) + 64 * 1024;

const NAME_LIMIT = 255;

export const FILE_NAME_LIMIT = 120;

export const AttachmentId = Schema.String.check(
  Schema.isPattern(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
);

export const AttachmentFileName = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9][\w-]*(?:\.[\w-]+)*$/));

export const AttachmentName = Schema.String.check(Schema.isMaxLength(NAME_LIMIT)).pipe(
  Schema.decodeTo(Schema.Trim.check(Schema.isNonEmpty()))
);

const MimeType = Schema.String.check(Schema.isPattern(/^[\w.+-]+\/[\w.+-]+$/));

export const AttachmentMimeType = Schema.optionalKey(Schema.NullOr(MimeType));

export const AttachmentData = Schema.String.check(Schema.isPattern(/^[A-Za-z0-9+/]*={0,2}$/));

export const AttachmentUpload = Schema.Struct({
  name: AttachmentName,
  mimeType: Schema.NullOr(MimeType),
  data: AttachmentData,
});
export type AttachmentUpload = typeof AttachmentUpload.Type;

export const NAME_INVALID = {
  code: 'attachment_name_invalid',
  message: 'Name the file in at most 255 characters.',
};

export const TYPE_INVALID = {
  code: 'attachment_type_invalid',
  message: 'Give the file type as a MIME type such as image/png.',
};

export const DATA_INVALID = { code: 'attachment_data_invalid', message: 'Send the file as base64.' };

export const EMPTY = { code: 'attachment_empty', message: 'The file is empty.' };

export const TOO_LARGE = {
  code: 'attachment_too_large',
  message: `The file is over ${ATTACHMENT_LIMIT_BYTES / 1024 / 1024} MB.`,
};
