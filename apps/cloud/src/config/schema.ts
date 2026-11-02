import { PREVIEW_ORIGIN, REMOTE_APP_ORIGIN } from '@shinsa/core';
import { Config, Redacted } from 'effect';

const DEFAULT_MAX_INSTANCES = 50;

export const CLOUD_CONFIG = Config.all({
  origin: Config.String('APP_ORIGIN').pipe(Config.withDefault(REMOTE_APP_ORIGIN)),
  githubClientId: Config.String('GITHUB_CLIENT_ID').pipe(Config.withDefault('')),
  githubClientSecret: Config.Redacted('GITHUB_CLIENT_SECRET').pipe(Config.withDefault(Redacted.make(''))),
  cloudflareAccountId: Config.String('CLOUDFLARE_ACCOUNT_ID').pipe(Config.withDefault('')),
  cloudflareApiToken: Config.Redacted('CLOUDFLARE_API_TOKEN').pipe(Config.withDefault(Redacted.make(''))),
  tunnelZone: Config.String('TUNNEL_ZONE').pipe(Config.withDefault('shinsa.dev')),
  previewOrigin: Config.String('PREVIEW_ZONE').pipe(
    Config.map((zone) => `https://${zone}`),
    Config.withDefault(PREVIEW_ORIGIN)
  ),
  maxInstances: Config.Int('MAX_INSTANCES').pipe(Config.withDefault(DEFAULT_MAX_INSTANCES)),
  slackClientId: Config.String('SLACK_CLIENT_ID').pipe(Config.withDefault('')),
  slackClientSecret: Config.Redacted('SLACK_CLIENT_SECRET').pipe(Config.withDefault(Redacted.make(''))),
  slackSigningSecret: Config.Redacted('SLACK_SIGNING_SECRET').pipe(Config.withDefault(Redacted.make(''))),
  slackTokenKey: Config.Redacted('SLACK_TOKEN_KEY').pipe(Config.withDefault(Redacted.make(''))),
});
