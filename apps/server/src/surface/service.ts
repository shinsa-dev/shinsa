import { DomainError } from '@shinsa/core';
import { describeVersion } from '../instance/index.ts';
import type { ServiceControl, ServiceInstall, ServiceStatus } from '../service/index.ts';
import type { SurfaceClient } from './client.ts';
import type { Values } from './fields.ts';
import type { SurfaceSpec } from './spec.ts';

interface ServiceDefinition {
  action: string;
  summary: string;
  access: SurfaceSpec['access'];
  fields?: SurfaceSpec['fields'];
  act: (service: ServiceControl, values: Values) => Promise<{ data: unknown; text: string }>;
}

const DEFAULT_LOG_LINES = 50;

function findService(client: SurfaceClient) {
  if (client.service) return client.service;
  throw new DomainError(
    'service_unavailable',
    'Only the `shinsa` command line manages the background service, from your own terminal.'
  );
}

function defineService(definition: ServiceDefinition): SurfaceSpec {
  return {
    path: ['service', definition.action],
    summary: definition.summary,
    fields: definition.fields ?? [],
    access: definition.access,
    humanOnly: true,
    run: async (client, values) => definition.act(findService(client), values),
  };
}

function describeJob(status: ServiceStatus) {
  if (!status.loaded) return status.installed ? 'installed, not loaded' : 'not installed';
  if (status.pid !== null) return `${status.state ?? 'running'} (pid ${status.pid})`;
  const exit = status.lastExitCode === null ? '' : `, last exit code ${status.lastExitCode}`;
  return `loaded, not running${exit}`;
}

function describeServer(status: ServiceStatus) {
  const { server } = status;
  if (!server) return 'Server: none on this data directory';
  const owner = server.service ? 'run by the service' : 'started outside the service';
  return `Server: ${server.url} (port ${server.port}, pid ${server.pid}, version ${describeVersion(server)}), ${owner}`;
}

function describeStatus(status: ServiceStatus) {
  return [
    `Service: ${describeJob(status)}`,
    describeServer(status),
    `Plist: ${status.plist}`,
    `Logs: ${status.log}`,
  ].join('\n');
}

function describeInstall(installed: ServiceInstall) {
  return [
    `${installed.replaced ? 'Reinstalled' : 'Installed'} the background service (${installed.label}). launchd starts Shinsa at login and again after a crash.`,
    `Runs: ${installed.program.join(' ')}`,
    `Plist: ${installed.plist}`,
    `Logs: ${installed.log}`,
    ...(installed.running
      ? [
          `Shinsa is already running on this data directory at ${installed.running.url} (pid ${installed.running.pid}). The service stays stopped while it runs: stop it, then run \`shinsa service restart\`.`,
        ]
      : []),
  ].join('\n');
}

export const SERVICE_SPECS: SurfaceSpec[] = [
  defineService({
    action: 'install',
    summary:
      'Run Shinsa in the background with launchd: at login, and again after a crash. Works without the server.',
    access: 'write',
    act: async (service) => {
      const data = await service.install();
      return { data, text: describeInstall(data) };
    },
  }),
  defineService({
    action: 'uninstall',
    summary: 'Stop the background service and remove it, so Shinsa no longer starts at login.',
    access: 'write',
    act: async (service) => {
      const data = await service.uninstall();
      const text =
        data.wasLoaded || data.removedPlist
          ? 'Removed the background service. Shinsa no longer starts at login.'
          : 'The background service was not installed.';
      return { data, text };
    },
  }),
  defineService({
    action: 'status',
    summary: 'Whether the background service is loaded and running, and which Shinsa it runs.',
    access: 'read',
    act: async (service) => {
      const data = await service.status();
      return { data, text: describeStatus(data) };
    },
  }),
  defineService({
    action: 'restart',
    summary: 'Restart the background service, after an update for example.',
    access: 'write',
    act: async (service) => {
      const data = await service.restart();
      return { data, text: `Restarted the background service.\n${describeStatus(data)}` };
    },
  }),
  defineService({
    action: 'logs',
    summary: 'Print the end of the background service’s log.',
    access: 'read',
    fields: [
      { name: 'lines', kind: 'integer', description: `How many lines (${DEFAULT_LOG_LINES} by default).` },
    ],
    act: (service, values) => {
      const data = service.logs(typeof values.lines === 'number' ? values.lines : DEFAULT_LOG_LINES);
      const text = data.lines.length === 0 ? `No log yet at ${data.path}.` : data.lines.join('\n');
      return Promise.resolve({ data, text });
    },
  }),
];
