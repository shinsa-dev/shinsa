import { type Redacted, Schema } from 'effect';

export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

export const Envelope = Schema.Struct({
  success: Schema.Boolean,
  result: Schema.optional(Schema.Unknown),
  errors: Schema.optional(Schema.Array(Schema.Struct({ message: Schema.optional(Schema.String) }))),
});

export const Identified = Schema.Struct({ id: Schema.NonEmptyString });

export interface CreatedTunnel {
  readonly tunnelId: string;
  readonly tunnelToken: Redacted.Redacted<string>;
  readonly dnsRecordId: string;
}

export type CloudflareMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
