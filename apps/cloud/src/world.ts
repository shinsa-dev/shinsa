import { REMOTE_APP_ORIGIN } from '@shinsa/core';
import type { CloudStore } from './database.ts';

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const DEFAULT_MAX_INSTANCES = 50;

export interface CloudConfig {
  origin: string;
  githubClientId: string;
  githubClientSecret: string;
  cloudflareAccountId: string;
  cloudflareApiToken: string;
  tunnelZone: string;
  maxInstances: number;
}

export interface CloudWorld {
  store: CloudStore;
  fetch: Fetch;
  assets: (request: Request) => Promise<Response>;
  now: () => number;
  config: CloudConfig;
}

export interface CloudEnv {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  TUNNEL_ZONE?: string;
  APP_ORIGIN?: string;
  MAX_INSTANCES?: string;
}

export function resolveCloudConfig(env: CloudEnv): CloudConfig {
  return {
    origin: env.APP_ORIGIN || REMOTE_APP_ORIGIN,
    githubClientId: env.GITHUB_CLIENT_ID ?? '',
    githubClientSecret: env.GITHUB_CLIENT_SECRET ?? '',
    cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID ?? '',
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN ?? '',
    tunnelZone: env.TUNNEL_ZONE || 'shinsa.dev',
    maxInstances: Number(env.MAX_INSTANCES) || DEFAULT_MAX_INSTANCES,
  };
}
