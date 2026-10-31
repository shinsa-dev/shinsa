import { CloudError } from './http.ts';
import { recordFailure } from './log.ts';
import type { CloudConfig, Fetch } from './world.ts';

const API = 'https://api.cloudflare.com/client/v4';

interface ApiAnswer<T> {
  success: boolean;
  result: T;
  errors?: { message?: string }[];
}

export interface CreatedTunnel {
  tunnelId: string;
  tunnelToken: string;
  dnsRecordId: string;
}

async function readAnswer<T>(response: Response) {
  try {
    return (await response.json()) as ApiAnswer<T>;
  } catch {
    return null;
  }
}

function resolveIngress(hostname: string, localUrl: string) {
  return { config: { ingress: [{ hostname, service: localUrl }, { service: 'http_status:404' }] } };
}

export function createCloudflare(config: CloudConfig, fetchApi: Fetch) {
  let zoneId: string | null = null;

  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetchApi(`${API}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${config.cloudflareApiToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const answer = await readAnswer<T>(response);
    if (!response.ok || !answer?.success) {
      const detail = answer?.errors?.[0]?.message ?? `status ${response.status}`;
      throw new CloudError('cloudflare_failed', `Cloudflare refused ${method} ${path}: ${detail}.`, 502);
    }
    return answer.result;
  }

  async function resolveZoneId() {
    if (zoneId) return zoneId;
    const zones = await call<{ id: string }[]>('GET', `/zones?name=${encodeURIComponent(config.tunnelZone)}`);
    const found = zones[0]?.id;
    if (!found)
      throw new CloudError('cloudflare_failed', `No Cloudflare zone named ${config.tunnelZone}.`, 502);
    zoneId = found;
    return found;
  }

  const account = `/accounts/${config.cloudflareAccountId}`;

  return {
    async createTunnel(name: string, hostname: string, localUrl: string): Promise<CreatedTunnel> {
      const tunnel = await call<{ id: string }>('POST', `${account}/cfd_tunnel`, {
        name,
        config_src: 'cloudflare',
      });
      try {
        await call(
          'PUT',
          `${account}/cfd_tunnel/${tunnel.id}/configurations`,
          resolveIngress(hostname, localUrl)
        );
        const tunnelToken = await call<string>('GET', `${account}/cfd_tunnel/${tunnel.id}/token`);
        const record = await call<{ id: string }>('POST', `/zones/${await resolveZoneId()}/dns_records`, {
          type: 'CNAME',
          name: hostname,
          content: `${tunnel.id}.cfargotunnel.com`,
          proxied: true,
        });
        return { tunnelId: tunnel.id, tunnelToken, dnsRecordId: record.id };
      } catch (error) {
        await call('DELETE', `${account}/cfd_tunnel/${tunnel.id}`).catch((cleanup: unknown) => {
          recordFailure('[Cloud] Could not remove a half-made tunnel', { tunnelId: tunnel.id, cleanup });
        });
        throw error;
      }
    },

    async updateIngress(tunnelId: string, hostname: string, localUrl: string) {
      await call(
        'PUT',
        `${account}/cfd_tunnel/${tunnelId}/configurations`,
        resolveIngress(hostname, localUrl)
      );
    },

    async removeTunnel(tunnelId: string, dnsRecordId: string) {
      await call('DELETE', `/zones/${await resolveZoneId()}/dns_records/${dnsRecordId}`);
      await call('DELETE', `${account}/cfd_tunnel/${tunnelId}?cascade=true`);
    },
  };
}
