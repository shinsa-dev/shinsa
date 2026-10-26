import { readFileSync } from 'node:fs';
import { get as getHttp } from 'node:http';
import { get as getHttps } from 'node:https';
import { homedir } from 'node:os';
import { app } from 'electron';
import { parseHealthText, type ServerHealth } from '../lib/health.ts';
import { parseConfigPort, resolveConfigPath, resolveServerUrl } from '../lib/server-url.ts';

const HEALTH_TIMEOUT_MS = 1500;

function readConfigText() {
  try {
    return readFileSync(resolveConfigPath(process.env, homedir()), 'utf8');
  } catch {
    return null;
  }
}

export function resolveAppServerUrl() {
  return resolveServerUrl({
    env: process.env,
    packaged: app.isPackaged,
    configPort: parseConfigPort(readConfigText()),
  });
}

export function requestHealth(url: string): Promise<ServerHealth | null> {
  const target = new URL('/api/health', url);
  const get = target.protocol === 'https:' ? getHttps : getHttp;
  return new Promise((resolve) => {
    const request = get(target, { timeout: HEALTH_TIMEOUT_MS }, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
      });
      response.on('error', () => resolve(null));
      response.on('end', () => resolve(response.statusCode === 200 ? parseHealthText(body) : null));
    });
    request.on('timeout', () => request.destroy());
    request.on('error', () => resolve(null));
  });
}
