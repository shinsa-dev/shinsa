import type {
  AccountsSnapshot,
  AttentionPlace,
  ChatEntry,
  EngineInfo,
  MachineResources,
  RemoteSnapshot,
  TeamFeedSnapshot,
  TerminalsSnapshot,
  UserCommand,
} from '@shinsa/core';
import { NO_TEAM_FEED } from '@shinsa/core';
import type { ShinsaConnection, Snapshot } from '@/lib/connection/socket.ts';
import { createSignal } from '@/lib/signal.ts';

export class FakeConnection implements ShinsaConnection {
  current: Snapshot = { state: null, status: 'connecting' };
  readonly commands: UserCommand[] = [];
  readonly watched: string[] = [];
  readonly calls: string[] = [];
  accounts: AccountsSnapshot | null = null;
  terminals: TerminalsSnapshot | null = null;
  resources: MachineResources | null = null;
  readonly resourcesSignal = createSignal();
  remote: RemoteSnapshot | null = null;
  teams: TeamFeedSnapshot = NO_TEAM_FEED;
  desktop = false;
  engine: EngineInfo | null = null;
  transcript: ChatEntry[] = [];
  readonly signal = createSignal();

  push(snapshot: Snapshot) {
    this.current = snapshot;
    this.signal.publish();
  }

  start = () => {
    this.calls.push('start');
  };
  subscribe = (listener: () => void) => this.signal.subscribe(listener);
  snapshot = () => this.current;
  subscribeTranscripts = (listener: () => void) => this.signal.subscribe(listener);
  selectTranscript = () => this.transcript;
  watchTranscript = (runId: string) => {
    this.watched.push(runId);
    return () => undefined;
  };
  readonly details: string[] = [];
  requestTaskDetail = (taskId: string) => {
    this.details.push(`request ${taskId}`);
  };
  watchTaskDetail = (taskId: string) => {
    this.details.push(`watch ${taskId}`);
    return () => undefined;
  };
  subscribeAccounts = (listener: () => void) => this.signal.subscribe(listener);
  selectAccounts = () => this.accounts;
  replaceAccounts = (accounts: AccountsSnapshot | null) => {
    this.accounts = accounts;
  };
  subscribeSurfaces = (listener: () => void) => this.signal.subscribe(listener);
  isDesktopConnected = () => this.desktop;
  attention: AttentionPlace = 'nowhere';
  presences = 0;
  reportPresence = () => {
    this.presences += 1;
  };
  selectAttention = () => this.attention;
  subscribeTerminals = (listener: () => void) => this.signal.subscribe(listener);
  selectTerminals = () => this.terminals;
  replaceTerminals = (terminals: TerminalsSnapshot) => {
    this.terminals = terminals;
  };
  pushResources(resources: MachineResources | null) {
    this.resources = resources;
    this.resourcesSignal.publish();
  }
  subscribeResources = (listener: () => void) => this.resourcesSignal.subscribe(listener);
  selectResources = () => this.resources;
  subscribeRemote = (listener: () => void) => this.signal.subscribe(listener);
  selectRemote = () => this.remote;
  replaceRemote = (remote: RemoteSnapshot) => {
    this.remote = remote;
  };
  subscribeTeams = (listener: () => void) => this.signal.subscribe(listener);
  selectTeams = () => this.teams;
  selectMachine = () => null;
  listMachines = () => [];
  listUnreachableMachines = () => [];
  listMachineAccess = () => [];
  removeMachine = () => undefined;
  selectEngine = () => this.engine;
  command = (command: UserCommand) => {
    this.commands.push(command);
    return Promise.resolve();
  };
  reset = () => {
    this.calls.push('reset');
  };
  flush = () => {
    this.calls.push('flush');
  };
}
