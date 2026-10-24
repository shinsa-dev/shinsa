interface FakeNotificationRecord {
  title: string;
  options: NotificationOptions;
  closed: boolean;
  click: () => void;
}

export function installNotifications(
  permission: NotificationPermission,
  answer: NotificationPermission = permission
) {
  const shown: FakeNotificationRecord[] = [];
  const requests: number[] = [];
  class FakeNotification {
    static permission: NotificationPermission = permission;
    static requestPermission() {
      requests.push(1);
      FakeNotification.permission = answer;
      return Promise.resolve(answer);
    }
    onclick: (() => void) | null = null;
    constructor(title: string, options: NotificationOptions) {
      const record: FakeNotificationRecord = {
        title,
        options,
        closed: false,
        click: () => this.onclick?.(),
      };
      shown.push(record);
      this.close = () => {
        record.closed = true;
      };
    }
    close: () => void;
  }
  Object.defineProperty(globalThis, 'Notification', {
    value: FakeNotification,
    configurable: true,
    writable: true,
  });
  return {
    shown,
    requests,
    restore: () => {
      Reflect.deleteProperty(globalThis, 'Notification');
    },
  };
}

interface PlayedNote {
  type: OscillatorType;
  frequency: number;
  start: number;
  stop: number;
}

export function installAudio(state: AudioContextState = 'running', resumeFails = false) {
  const played: PlayedNote[] = [];
  const created: FakeAudioContext[] = [];
  const disconnected: string[] = [];
  class FakeAudioContext {
    state = state;
    currentTime = 10;
    destination = { kind: 'destination' };
    resumed = 0;
    constructor() {
      created.push(this);
    }
    resume() {
      this.resumed += 1;
      if (resumeFails) return Promise.reject(new Error('blocked'));
      this.state = 'running';
      return Promise.resolve();
    }
    createGain() {
      return {
        gain: {
          setValueAtTime: () => undefined,
          exponentialRampToValueAtTime: () => undefined,
        },
        connect: () => undefined,
        disconnect: () => disconnected.push('gain'),
      };
    }
    createOscillator() {
      const note: PlayedNote = { type: 'sine', frequency: 0, start: 0, stop: 0 };
      const oscillator = {
        set type(value: OscillatorType) {
          note.type = value;
        },
        frequency: {
          setValueAtTime: (value: number) => {
            note.frequency = value;
          },
        },
        onended: null as (() => void) | null,
        connect: () => undefined,
        disconnect: () => disconnected.push('oscillator'),
        start: (at: number) => {
          note.start = at;
          played.push(note);
        },
        stop: (at: number) => {
          note.stop = at;
          oscillator.onended?.();
        },
      };
      return oscillator;
    }
  }
  Object.defineProperty(globalThis, 'AudioContext', {
    value: FakeAudioContext,
    configurable: true,
    writable: true,
  });
  return {
    played,
    created,
    disconnected,
    restore: () => {
      Reflect.deleteProperty(globalThis, 'AudioContext');
    },
  };
}
