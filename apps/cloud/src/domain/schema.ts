import { Duration } from 'effect';

export const ONLINE_WINDOW = Duration.minutes(5);

export type ChannelKind = 'remote' | 'team';
