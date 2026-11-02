import { Schema, SchemaTransformation } from 'effect';
import { HttpApiSchema } from 'effect/http-api';
import {
  EditConflict,
  type EngineFailureBody,
  FILE_NOT_FOUND_TEXT,
  FileNotFound,
  RequestFailed,
} from './schema.ts';

interface FixedFailure<Self, Tag extends string, Code extends string> extends Schema.Codec<
  Self,
  { readonly _tag: Tag; readonly message: string }
> {
  readonly identifier: Tag;
  readonly code: Code;
  readonly status: number;
}

export function resolveEngineFailureWire<Self, const Tag extends string, const Code extends string>(
  failure: FixedFailure<Self, Tag, Code>
) {
  const tag = failure.identifier;
  return Schema.Struct({
    error: Schema.Struct({ code: Schema.Literal(failure.code), message: Schema.String }),
  })
    .pipe(
      Schema.decodeTo(
        failure,
        SchemaTransformation.transform({
          decode: (body) => ({ _tag: tag, message: body.error.message }),
          encode: (error) => ({ error: { code: failure.code, message: error.message } }),
        })
      )
    )
    .annotate({ httpApiStatus: failure.status });
}

export const RequestFailedWire = Schema.Struct({
  error: Schema.Struct({ code: Schema.String, message: Schema.String }),
})
  .pipe(
    Schema.decodeTo(
      RequestFailed,
      SchemaTransformation.transform({
        decode: (body) => ({ _tag: 'RequestFailed' as const, ...body.error }),
        encode: (error) => ({ error: { code: error.code, message: error.message } }),
      })
    )
  )
  .annotate({ httpApiStatus: RequestFailed.status });

export const EditConflictWire = Schema.Struct({
  error: Schema.Struct({ code: Schema.Literal(EditConflict.code), message: Schema.String }),
  content: Schema.NullOr(Schema.String),
})
  .pipe(
    Schema.decodeTo(
      EditConflict,
      SchemaTransformation.transform({
        decode: (body) => ({
          _tag: 'EditConflict' as const,
          message: body.error.message,
          content: body.content,
        }),
        encode: (error) => ({
          error: { code: EditConflict.code, message: error.message },
          content: error.content,
        }),
      })
    )
  )
  .annotate({ httpApiStatus: EditConflict.status });

export const FileNotFoundWire = Schema.Literal(FILE_NOT_FOUND_TEXT)
  .pipe(
    Schema.decodeTo(
      FileNotFound,
      SchemaTransformation.transform({
        decode: () => ({ _tag: 'FileNotFound' as const }),
        encode: () => FILE_NOT_FOUND_TEXT,
      })
    ),
    HttpApiSchema.asText()
  )
  .annotate({ httpApiStatus: FileNotFound.status });

export function serializeEngineFailure(error: {
  readonly code: string;
  readonly message: string;
}): EngineFailureBody {
  return { error: { code: error.code, message: error.message } };
}
