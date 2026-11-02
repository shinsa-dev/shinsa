import { PREVIEW_ORIGIN, REMOTE_APP_ORIGIN } from '@shinsa/core';
import { Config, Context, Layer, Redacted } from 'effect';

const DEFAULT_MAX_INSTANCES = 50;

const Setting = (name: string) => Config.String(name).pipe(Config.withDefault(''));

const Secret = (name: string) => Config.Redacted(name).pipe(Config.withDefault(Redacted.make('')));

const CLOUD_CONFIG = Config.all({
  origin: Config.String('APP_ORIGIN').pipe(Config.withDefault(REMOTE_APP_ORIGIN)),
  githubClientId: Setting('GITHUB_CLIENT_ID'),
  githubClientSecret: Secret('GITHUB_CLIENT_SECRET'),
  cloudflareAccountId: Setting('CLOUDFLARE_ACCOUNT_ID'),
  cloudflareApiToken: Secret('CLOUDFLARE_API_TOKEN'),
  tunnelZone: Config.String('TUNNEL_ZONE').pipe(Config.withDefault('shinsa.dev')),
  previewOrigin: Config.String('PREVIEW_ZONE').pipe(
    Config.map((zone) => `https://${zone}`),
    Config.withDefault(PREVIEW_ORIGIN)
  ),
  maxInstances: Config.Int('MAX_INSTANCES').pipe(Config.withDefault(DEFAULT_MAX_INSTANCES)),
  slackClientId: Setting('SLACK_CLIENT_ID'),
  slackClientSecret: Secret('SLACK_CLIENT_SECRET'),
  slackSigningSecret: Secret('SLACK_SIGNING_SECRET'),
  slackTokenKey: Secret('SLACK_TOKEN_KEY'),
});

export class CloudConfig extends Context.Service<CloudConfig, Config.Success<typeof CLOUD_CONFIG>>()(
  'shinsa/cloud/config/CloudConfig'
) {
  static readonly layer = Layer.effect(CloudConfig, CLOUD_CONFIG);
}
