import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { app } from 'electron';
import {
  APP_ID,
  ENGINE_LOCK,
  ENGINE_LOG,
  ENGINE_PLIST,
  type EngineScreen,
  isCrashing,
  isOnOtherPort,
  isSpawnRefused,
  isStandaloneAgent,
  listEngineVariables,
  parseLaunchdJob,
  parseRegistration,
  type Registration,
  resolveDataDir,
  resolveEngineProgram,
  resolveEngineTarget,
  resolveLaunchAgentPath,
  resolveLogTail,
  selectBusyPort,
  serializeEngineAgent,
} from '../lib/engine.ts';
import type { ServerHealth } from '../lib/health.ts';
import { requestHealth } from './server.ts';

const START_WAIT_MS = 25_000;

const KICK_AFTER_MS = 3000;

const POLL_MS = 400;

const LOAD_WAIT_MS = 3000;

const LAUNCHCTL_TIMEOUT_MS = 15_000;

const uid = process.getuid?.() ?? 0;

function launchctl(args: string[]) {
  return new Promise<{ ok: boolean; output: string }>((resolve) => {
    execFile('/bin/launchctl', args, { timeout: LAUNCHCTL_TIMEOUT_MS }, (error, stdout, stderr) =>
      resolve({ ok: !error, output: `${stdout}${stderr}` })
    );
  });
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readRegistration(): Registration {
  try {
    return parseRegistration(
      app.getLoginItemSettings({ type: 'agentService', serviceName: ENGINE_PLIST }).status
    );
  } catch {
    return 'unsupported';
  }
}

function registerAppService(): Registration {
  try {
    app.setLoginItemSettings({ openAtLogin: true, type: 'agentService', serviceName: ENGINE_PLIST });
  } catch {
    return 'unsupported';
  }
  return readRegistration();
}

function unregisterAppService() {
  try {
    app.setLoginItemSettings({ openAtLogin: false, type: 'agentService', serviceName: ENGINE_PLIST });
  } catch {
    return;
  }
}

async function isRefused() {
  return isSpawnRefused(parseLaunchdJob((await launchctl(['print', resolveEngineTarget(uid)])).output));
}

async function isLoaded(waitMs = 0) {
  const deadline = Date.now() + waitMs;
  for (;;) {
    if ((await launchctl(['print', resolveEngineTarget(uid)])).ok) return true;
    if (Date.now() >= deadline) return false;
    await wait(POLL_MS);
  }
}

export class EngineSupervisor {
  readonly origin: string;
  #retiredOldService = false;

  constructor(origin: string) {
    this.origin = origin;
  }

  get dataDir() {
    return resolveDataDir(process.env, homedir());
  }

  async ensure(onStarting: () => void): Promise<{ health: ServerHealth } | { screen: EngineScreen }> {
    await this.#takeOverStandaloneEngine();
    const running = await requestHealth(this.origin);
    if (running) return { health: running };
    if (!app.isPackaged) return { screen: { kind: 'dev' } };
    onStarting();
    await this.#moveToThisPort();
    await this.#retireOldService();
    const registration = await this.#register();
    if (registration === 'requires-approval') return { screen: { kind: 'approval' } };
    const health = (await this.#waitForEngine()) ?? (await this.#registerAgain());
    if (health) return { health };
    return { screen: await this.#describeFailure() };
  }

  async #registerAgain() {
    if (!(await isRefused())) return null;
    unregisterAppService();
    await this.#removeLaunchAgent();
    const registered = registerAppService();
    if (registered !== 'enabled' || !(await isLoaded(LOAD_WAIT_MS))) {
      unregisterAppService();
      await this.#installLaunchAgent();
    }
    return this.#waitForEngine();
  }

  async restart() {
    await launchctl(['kickstart', '-k', resolveEngineTarget(uid)]);
  }

  readDetails() {
    return [`Engine log: ${join(this.dataDir, ENGINE_LOG)}`, this.#readLogTail()]
      .filter(Boolean)
      .join('\n\n');
  }

  async #moveToThisPort() {
    const port = Number(new URL(this.origin).port);
    if (!port) return;
    const job = parseLaunchdJob((await launchctl(['print', resolveEngineTarget(uid)])).output);
    if (isOnOtherPort(job, this.#readText(ENGINE_LOCK), port)) await this.restart();
  }

  async #takeOverStandaloneEngine() {
    if (!app.isPackaged) return;
    const plist = resolveLaunchAgentPath(homedir());
    if (!existsSync(plist)) return;
    if (!isStandaloneAgent(readFileSync(plist, 'utf8'), resolveEngineProgram(process.resourcesPath))) return;
    await launchctl(['bootout', resolveEngineTarget(uid)]);
    rmSync(plist, { force: true });
  }

  async #retireOldService() {
    if (this.#retiredOldService) return;
    this.#retiredOldService = true;
    const plist = resolveLaunchAgentPath(homedir(), APP_ID);
    if (!existsSync(plist)) return;
    await launchctl(['bootout', resolveEngineTarget(uid, APP_ID)]);
    rmSync(plist, { force: true });
  }

  async #register(): Promise<Registration> {
    const current = readRegistration();
    if (current === 'requires-approval') return current;
    if (current === 'enabled' && (await isLoaded())) return current;
    if (current === 'enabled') unregisterAppService();
    const registered = registerAppService();
    if (registered === 'requires-approval') return registered;
    if (registered === 'enabled' && (await isLoaded(LOAD_WAIT_MS))) {
      await this.#removeLaunchAgent();
      return registered;
    }
    if (registered === 'enabled') unregisterAppService();
    await this.#installLaunchAgent();
    return 'enabled';
  }

  async #installLaunchAgent() {
    const plist = resolveLaunchAgentPath(homedir());
    const text = serializeEngineAgent(
      { path: resolveEngineProgram(process.resourcesPath) },
      listEngineVariables(process.env)
    );
    const current = existsSync(plist) ? readFileSync(plist, 'utf8') : null;
    const target = resolveEngineTarget(uid);
    const loaded = await isLoaded();
    if (current === text && loaded) return;
    if (loaded) await launchctl(['bootout', target]);
    mkdirSync(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });
    writeFileSync(plist, text);
    await launchctl(['bootstrap', `gui/${uid}`, plist]);
  }

  async #removeLaunchAgent() {
    const plist = resolveLaunchAgentPath(homedir());
    if (!existsSync(plist)) return;
    await launchctl(['bootout', resolveEngineTarget(uid)]);
    rmSync(plist, { force: true });
  }

  async #waitForEngine() {
    const started = Date.now();
    let kicked = false;
    while (Date.now() - started < START_WAIT_MS) {
      const health = await requestHealth(this.origin);
      if (health) return health;
      if (!kicked && Date.now() - started > KICK_AFTER_MS) {
        kicked = true;
        if (await isRefused()) return null;
        await launchctl(['kickstart', resolveEngineTarget(uid)]);
      }
      await wait(POLL_MS);
    }
    return null;
  }

  async #describeFailure(): Promise<EngineScreen> {
    const printed = await launchctl(['print', resolveEngineTarget(uid)]);
    const job = parseLaunchdJob(printed.output);
    const detail = this.readDetails();
    const port = selectBusyPort(detail);
    if (port !== null) return { kind: 'port', port, detail };
    if (isCrashing(job)) return { kind: 'crashing', detail };
    return { kind: 'stopped', detail };
  }

  #readText(file: string) {
    try {
      return readFileSync(join(this.dataDir, file), 'utf8');
    } catch {
      return null;
    }
  }

  #readLogTail() {
    return resolveLogTail(this.#readText(ENGINE_LOG) ?? '');
  }
}
