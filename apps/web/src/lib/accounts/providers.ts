import type { ProviderLogin } from '@shinsa/core';
import type { Tone } from '@/lib/format/tone.ts';

export interface ProviderLoginView {
  title: string;
  status: { label: string; tone: Tone } | null;
  fix: string | null;
  command: string | null;
}

const COMMAND = /`([^`]+)`/;

function resolveTitle(login: ProviderLogin) {
  switch (login.status) {
    case 'signed_in':
      return login.method ? `Signed in with ${login.method}` : 'Signed in';
    case 'signed_out':
      return 'Not signed in';
    case 'not_installed':
      return 'Not installed';
    case 'outdated':
      return 'Too old for Shinsa';
    case 'unknown':
      return 'Could not check the sign-in';
  }
}

const STATUS: Partial<Record<ProviderLogin['status'], ProviderLoginView['status']>> = {
  signed_out: { label: 'Needs sign-in', tone: 'orange' },
  outdated: { label: 'Update needed', tone: 'orange' },
};

export function describeProviderLogin(login: ProviderLogin): ProviderLoginView {
  const fix = login.fix ?? (login.status === 'outdated' ? login.detail : null);
  return {
    title: resolveTitle(login),
    status: STATUS[login.status] ?? null,
    fix,
    command: (fix && COMMAND.exec(fix)?.[1]) ?? null,
  };
}

export function describeProviderRefresh(login: ProviderLogin) {
  return `Check the ${login.label} sign-in again`;
}
