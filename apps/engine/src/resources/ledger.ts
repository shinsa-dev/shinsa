export type ProcessKind = 'agent' | 'services' | 'checks';

export interface ProcessRoot {
  taskId: string;
  kind: ProcessKind;
  pid: number;
}

export interface ServiceProcess {
  taskId: string;
  pid: number;
}

export type ProcessTracker = (taskId: string, kind: ProcessKind, pid: number) => () => void;

const NO_SERVICES = (): ServiceProcess[] => [];

export class ProcessLedger {
  readonly #roots = new Map<number, ProcessRoot>();
  readonly #listServices: () => ServiceProcess[];

  constructor(listServices: () => ServiceProcess[] = NO_SERVICES) {
    this.#listServices = listServices;
  }

  track: ProcessTracker = (taskId, kind, pid) => {
    const root = { taskId, kind, pid };
    this.#roots.set(pid, root);
    return () => {
      if (this.#roots.get(pid) === root) this.#roots.delete(pid);
    };
  };

  listRoots(): ProcessRoot[] {
    const services = this.#listServices().map((service) => ({ ...service, kind: 'services' as const }));
    return [...this.#roots.values(), ...services];
  }
}
