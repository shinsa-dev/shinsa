import { describeList } from '@shinsa/core';

export const PAIR_STEPS = [
  'Open Shinsa on the machine that runs it.',
  'Go to Settings, Remote access and choose Turn on.',
  'Sign in with GitHub and approve the code it shows. The machine shows up here.',
];

export function describeMachineName(name: string) {
  return `“${name}”`;
}

export function describeMachineNames(names: readonly string[]) {
  return describeList(names.map(describeMachineName));
}

export function listAddDeviceSteps(machines: readonly string[]) {
  return [
    `On ${describeMachineNames(machines)}, open Settings > Remote access and choose Invite link.`,
    'Scan the QR code with this device, or open the link here, and ask for access.',
    'Accept the request on the machine.',
  ];
}
