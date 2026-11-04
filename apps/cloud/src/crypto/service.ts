import {
  ClaimCode,
  concatBytes,
  decodeText,
  encodeText,
  InstanceId,
  isSameSecret,
  type MachineCredentials,
  PAIRING_SEAL_IV_BYTES,
  parseBase64Url,
  REMOTE_KEY_ALGORITHM,
  sealPairingCredentials,
  serializeBase64Url,
  serializeHex,
  TeamId,
} from '@shinsa/core';
import { Context, Effect, Layer, Option, Redacted } from 'effect';
import { CloudConfig } from '../config/service.ts';
import {
  CLAIM_ALPHABET,
  CLAIM_CODE_LENGTH,
  CryptoFailed,
  DEFAULT_TOKEN_BYTES,
  ID_ALPHABET,
  ID_LENGTH,
  SEALED_IV_BYTES,
  TOKEN_KEY_BYTES,
  TokenHash,
} from './schema.ts';

export class CloudCrypto extends Context.Service<
  CloudCrypto,
  {
    createToken(bytes?: number): Effect.Effect<Redacted.Redacted<string>>;
    readonly createClaimCode: Effect.Effect<ClaimCode>;
    readonly createInstanceId: Effect.Effect<InstanceId>;
    readonly createTeamId: Effect.Effect<TeamId>;
    hashToken(token: Redacted.Redacted<string>): Effect.Effect<TokenHash>;
    createCodeChallenge(verifier: Redacted.Redacted<string>): Effect.Effect<string>;
    sealToken(token: Redacted.Redacted<string>): Effect.Effect<string>;
    openToken(sealed: string): Effect.Effect<Redacted.Redacted<string>>;
    sealCredentials(machineKey: string, credentials: MachineCredentials): Effect.Effect<string>;
    isSlackSignature(timestamp: string, body: string, signature: string): Effect.Effect<boolean>;
    signSlack(timestamp: string, body: string): Effect.Effect<Option.Option<string>>;
  }
>()('shinsa/cloud/crypto/CloudCrypto') {
  static readonly layer = Layer.effect(
    CloudCrypto,
    Effect.gen(function* () {
      const config = yield* CloudConfig;

      const isSameText = Redacted.makeEquivalence(isSameSecret);

      const createRandomBytes = (length: number) => crypto.getRandomValues(new Uint8Array(length));

      const createFromAlphabet = (alphabet: string, length: number) => {
        const limit = 256 - (256 % alphabet.length);
        let text = '';
        while (text.length < length) {
          for (const byte of createRandomBytes(length * 2)) {
            if (byte >= limit || text.length === length) continue;
            text += alphabet[byte % alphabet.length];
          }
        }
        return text;
      };

      const digest = (text: string) =>
        Effect.promise(() => crypto.subtle.digest('SHA-256', encodeText(text))).pipe(
          Effect.map((buffer) => new Uint8Array(buffer))
        );

      const tokenKey = yield* Effect.cached(
        Effect.gen(function* () {
          const raw = parseBase64Url(Redacted.value(config.slackTokenKey));
          if (raw?.length !== TOKEN_KEY_BYTES)
            return yield* new CryptoFailed({ message: 'SLACK_TOKEN_KEY must be 32 bytes in base64url.' });
          return yield* Effect.promise(() =>
            crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
          );
        }).pipe(Effect.orDie)
      );

      const signingKey = yield* Effect.cached(
        Effect.gen(function* () {
          const secret = Redacted.value(config.slackSigningSecret);
          if (secret === '') return Option.none<CryptoKey>();
          const key = yield* Effect.promise(() =>
            crypto.subtle.importKey('raw', encodeText(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
              'sign',
            ])
          );
          return Option.some(key);
        })
      );

      const createToken = (bytes = DEFAULT_TOKEN_BYTES) =>
        Effect.sync(() => Redacted.make(serializeBase64Url(createRandomBytes(bytes))));

      const hashToken = Effect.fn('CloudCrypto.hashToken')(function* (token: Redacted.Redacted<string>) {
        return TokenHash.make(serializeHex(yield* digest(Redacted.value(token))));
      });

      const createCodeChallenge = Effect.fn('CloudCrypto.createCodeChallenge')(function* (
        verifier: Redacted.Redacted<string>
      ) {
        return serializeBase64Url(yield* digest(Redacted.value(verifier)));
      });

      const sealToken = Effect.fn('CloudCrypto.sealToken')(function* (token: Redacted.Redacted<string>) {
        const key = yield* tokenKey;
        const iv = createRandomBytes(SEALED_IV_BYTES);
        const sealed = yield* Effect.promise(() =>
          crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encodeText(Redacted.value(token)))
        );
        return serializeBase64Url(concatBytes(iv, new Uint8Array(sealed)));
      });

      const openToken = Effect.fn('CloudCrypto.openToken')(function* (sealed: string) {
        const bytes = parseBase64Url(sealed);
        if (!bytes || bytes.length <= SEALED_IV_BYTES)
          return yield* new CryptoFailed({ message: 'The stored token is not sealed.' });
        const key = yield* tokenKey;
        const opened = yield* Effect.tryPromise({
          try: () =>
            crypto.subtle.decrypt(
              { name: 'AES-GCM', iv: bytes.slice(0, SEALED_IV_BYTES) },
              key,
              bytes.slice(SEALED_IV_BYTES)
            ),
          catch: () => new CryptoFailed({ message: 'The stored token does not open with SLACK_TOKEN_KEY.' }),
        });
        return Redacted.make(decodeText(new Uint8Array(opened)));
      }, Effect.orDie);

      const sealCredentials = Effect.fn('CloudCrypto.sealCredentials')(function* (
        machineKey: string,
        credentials: MachineCredentials
      ) {
        const ephemeral = yield* Effect.promise(
          () =>
            crypto.subtle.generateKey(REMOTE_KEY_ALGORITHM, true, ['deriveBits']) as Promise<CryptoKeyPair>
        );
        const iv = createRandomBytes(PAIRING_SEAL_IV_BYTES);
        return yield* sealPairingCredentials({ machineKey, ephemeral, iv }, credentials).pipe(Effect.orDie);
      });

      const signSlack = Effect.fn('CloudCrypto.signSlack')(function* (timestamp: string, body: string) {
        const key = yield* signingKey;
        if (Option.isNone(key)) return Option.none<string>();
        const signature = yield* Effect.promise(() =>
          crypto.subtle.sign('HMAC', key.value, encodeText(`v0:${timestamp}:${body}`))
        );
        return Option.some(`v0=${serializeHex(new Uint8Array(signature))}`);
      });

      const isSlackSignature = Effect.fn('CloudCrypto.isSlackSignature')(function* (
        timestamp: string,
        body: string,
        signature: string
      ) {
        const expected = yield* signSlack(timestamp, body);
        return Option.isSome(expected) && isSameText(Redacted.make(expected.value), Redacted.make(signature));
      });

      return CloudCrypto.of({
        createToken,
        createClaimCode: Effect.sync(() =>
          ClaimCode.make(createFromAlphabet(CLAIM_ALPHABET, CLAIM_CODE_LENGTH))
        ),
        createInstanceId: Effect.sync(() => InstanceId.make(createFromAlphabet(ID_ALPHABET, ID_LENGTH))),
        createTeamId: Effect.sync(() => TeamId.make(createFromAlphabet(ID_ALPHABET, ID_LENGTH))),
        hashToken,
        createCodeChallenge,
        sealToken,
        openToken,
        sealCredentials,
        isSlackSignature,
        signSlack,
      });
    })
  );
}
