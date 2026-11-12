import { PREVIEW_ORIGIN, REMOTE_APP_ORIGIN, REMOTE_PATHS, SLACK_RELAY_PATHS } from '@shinsa/core';
import { Config, Redacted } from 'effect';

const DEFAULT_MAX_INSTANCES = 10_000;

const ORIGIN = Config.String('APP_ORIGIN').pipe(Config.withDefault(REMOTE_APP_ORIGIN));

export const CLOUD_CONFIG = Config.all({
  origin: ORIGIN,
  signInCallbackUrl: ORIGIN.pipe(Config.map((origin) => `${origin}${REMOTE_PATHS.signInCallback}`)),
  slackConnectCallbackUrl: ORIGIN.pipe(
    Config.map((origin) => `${origin}${SLACK_RELAY_PATHS.connectCallback}`)
  ),
  slackInstallCallbackUrl: ORIGIN.pipe(
    Config.map((origin) => `${origin}${SLACK_RELAY_PATHS.installCallback}`)
  ),
  githubClientId: Config.String('GITHUB_CLIENT_ID').pipe(Config.withDefault('')),
  githubClientSecret: Config.Redacted('GITHUB_CLIENT_SECRET').pipe(Config.withDefault(Redacted.make(''))),
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
