import { Schema } from 'effect';

export interface BenchMachine {
  connectKey: string;
  machineKey: string;
  device: CryptoKeyPair;
}

export class RemoteBenchFailed extends Schema.TaggedError<
  RemoteBenchFailed,
  { readonly brand: unique symbol }
>()('RemoteBenchFailed', { message: Schema.String }) {}

export const INSTANCE = 'bench';

export const USER_ID = '1';

export const MACHINE_TOKEN = 'bench';

export const API_PATHS = ['/api/health', '/api/queue'];

export const PARALLEL = 10;

export const PARALLEL_ROUNDS = 5;

export const MAX_BODY_BYTES = 32 * 1024 * 1024;
