import { APP_IDENTITY } from '@shinsa/core';

export const URL_SCHEME = APP_IDENTITY.scheme;

export const TASK_REFERENCE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

export const LINK_PROTOCOL = /^[a-z-]+:/i;

export const LINK_PAGES: Readonly<Record<string, string>> = {
  '': '/',
  home: '/',
  tasks: '/tasks',
  settings: '/settings',
};
