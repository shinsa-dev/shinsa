export type SlackPost = { kind: 'result' } | { kind: 'completed' } | { kind: 'tripped'; watchdogId: string };
