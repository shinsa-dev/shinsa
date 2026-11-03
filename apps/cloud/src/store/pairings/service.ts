import { ClaimCode } from '@shinsa/core';
import { Clock, Context, Effect, Layer, Option, Schema } from 'effect';
import { SqlClient, SqlSchema } from 'effect/sql';
import { Count } from '../shared/schema.ts';

import { NewPairing, Pairing } from './schema.ts';

export class Pairings extends Context.Service<
  Pairings,
  {
    create(pairing: NewPairing, clientIp: string): Effect.Effect<void>;
    readonly removeExpired: Effect.Effect<void>;
    countFrom(clientIp: string): Effect.Effect<number>;
    select(claimCode: ClaimCode): Effect.Effect<Option.Option<Pairing>>;
    reserve(claimCode: ClaimCode, ownerLogin: string): Effect.Effect<boolean>;
    release(claimCode: ClaimCode): Effect.Effect<void>;
    recordClaim(claimCode: ClaimCode, sealedCredentials: string): Effect.Effect<void>;
    remove(claimCode: ClaimCode): Effect.Effect<void>;
  }
>()('shinsa/cloud/store/Pairings') {
  static readonly layer = Layer.effect(
    Pairings,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const insert = SqlSchema.void({
        Request: Schema.Struct({ ...NewPairing.fields, clientIp: Schema.String }),
        execute: (row) =>
          sql`INSERT INTO pair_sessions (claim_code, poll_secret_hash, name, public_key, version, client_ip, expires_at) VALUES (${row.claimCode}, ${row.pollSecretHash}, ${row.name}, ${row.publicKey}, ${row.version}, ${row.clientIp}, ${row.expiresAt})`,
      });
      const expiredRemoval = SqlSchema.void({
        Request: Schema.Number,
        execute: (now) => sql`DELETE FROM pair_sessions WHERE expires_at <= ${now}`,
      });
      const countByIp = SqlSchema.findOne({
        Request: Schema.String,
        Result: Count,
        execute: (ip) => sql`SELECT COUNT(*) AS total FROM pair_sessions WHERE client_ip = ${ip}`,
      });
      const byCode = SqlSchema.findOneOption({
        Request: ClaimCode,
        Result: Pairing,
        execute: (code) =>
          sql`SELECT claim_code, poll_secret_hash, name, public_key, version, expires_at, credentials, owner FROM pair_sessions WHERE claim_code = ${code}`,
      });
      const reservation = SqlSchema.findOneOption({
        Request: Schema.Struct({ claimCode: ClaimCode, owner: Schema.String }),
        Result: Schema.Struct({ claimCode: ClaimCode }),
        execute: (row) =>
          sql`UPDATE pair_sessions SET owner = ${row.owner} WHERE claim_code = ${row.claimCode} AND owner IS NULL RETURNING claim_code`,
      });
      const release = SqlSchema.void({
        Request: ClaimCode,
        execute: (code) =>
          sql`UPDATE pair_sessions SET owner = NULL WHERE claim_code = ${code} AND credentials IS NULL`,
      });
      const claim = SqlSchema.void({
        Request: Schema.Struct({
          claimCode: ClaimCode,
          credentials: Schema.String,
        }),
        execute: (row) =>
          sql`UPDATE pair_sessions SET credentials = ${row.credentials} WHERE claim_code = ${row.claimCode}`,
      });
      const removal = SqlSchema.void({
        Request: ClaimCode,
        execute: (code) => sql`DELETE FROM pair_sessions WHERE claim_code = ${code}`,
      });

      return Pairings.of({
        create: Effect.fn('Pairings.create')(
          (pairing: NewPairing, clientIp: string) => insert({ ...pairing, clientIp }),
          Effect.orDie
        ),
        removeExpired: Effect.flatMap(Clock.currentTimeMillis, expiredRemoval).pipe(
          Effect.orDie,
          Effect.withSpan('Pairings.removeExpired')
        ),
        countFrom: Effect.fn('Pairings.countFrom')((clientIp: string) => countByIp(clientIp), Effect.orDie),
        select: Effect.fn('Pairings.select')((code: ClaimCode) => byCode(code), Effect.orDie),
        reserve: Effect.fn('Pairings.reserve')(
          (claimCode: ClaimCode, ownerLogin: string) =>
            Effect.map(reservation({ claimCode, owner: ownerLogin }), Option.isSome),
          Effect.orDie
        ),
        release: Effect.fn('Pairings.release')((code: ClaimCode) => release(code), Effect.orDie),
        recordClaim: Effect.fn('Pairings.recordClaim')(
          (claimCode: ClaimCode, sealedCredentials: string) =>
            claim({ claimCode, credentials: sealedCredentials }),
          Effect.orDie
        ),
        remove: Effect.fn('Pairings.remove')((code: ClaimCode) => removal(code), Effect.orDie),
      });
    })
  );
}
