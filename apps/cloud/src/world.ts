import { PREVIEW_ORIGIN, REMOTE_APP_ORIGIN } from '@shinsa/core';
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
  previewOrigin: string;
  maxInstances: number;
  slackClientId: string;
  slackClientSecret: string;
  slackSigningSecret: string;
  slackTokenKey: string;
}

export interface CloudWorld {
  store: CloudStore;
  fetch: Fetch;
  assets: (request: Request) => Promise<Response>;
  now: () => number;
  defer: (work: Promise<unknown>) => void;
  config: CloudConfig;
}

export interface CloudEnv {
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN?: string;
  TUNNEL_ZONE?: string;
  PREVIEW_ZONE?: string;
  APP_ORIGIN?: string;
  MAX_INSTANCES?: string;
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  SLACK_SIGNING_SECRET?: string;
  SLACK_TOKEN_KEY?: string;
}

export function resolveCloudConfig(env: CloudEnv): CloudConfig {
  return {
    origin: env.APP_ORIGIN || REMOTE_APP_ORIGIN,
    githubClientId: env.GITHUB_CLIENT_ID ?? '',
    githubClientSecret: env.GITHUB_CLIENT_SECRET ?? '',
    cloudflareAccountId: env.CLOUDFLARE_ACCOUNT_ID ?? '',
    cloudflareApiToken: env.CLOUDFLARE_API_TOKEN ?? '',
    tunnelZone: env.TUNNEL_ZONE || 'shinsa.dev',
    previewOrigin: env.PREVIEW_ZONE ? `https://${env.PREVIEW_ZONE}` : PREVIEW_ORIGIN,
    maxInstances: Number(env.MAX_INSTANCES) || DEFAULT_MAX_INSTANCES,
    slackClientId: env.SLACK_CLIENT_ID ?? '',
    slackClientSecret: env.SLACK_CLIENT_SECRET ?? '',
    slackSigningSecret: env.SLACK_SIGNING_SECRET ?? '',
    slackTokenKey: env.SLACK_TOKEN_KEY ?? '',
  };
}
