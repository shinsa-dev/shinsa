import type { ServiceDefinition, ServiceView } from '@shinsa/core';
import * as React from 'react';

export type ServicesPanelMode = 'list' | 'add' | 'manage';

export interface ServicesPanelState {
  view: 'list' | 'add' | 'custom' | 'edit';
  manage: boolean;
  picked: string[];
  confirming: boolean;
  projectId: string | null;
  editing: string | null;
}

export type ServicesPanelAction =
  | { type: 'open'; mode: ServicesPanelMode; projectId: string | null }
  | { type: 'custom' }
  | { type: 'back' }
  | { type: 'done' }
  | { type: 'manage'; on: boolean }
  | { type: 'pick'; picked: string[] }
  | { type: 'confirm'; on: boolean }
  | { type: 'removed' }
  | { type: 'edit'; serviceId: string }
  | { type: 'project'; projectId: string };

export function createServicesPanel(mode: ServicesPanelMode, projectId: string | null): ServicesPanelState {
  return {
    view: mode === 'add' && projectId ? 'add' : 'list',
    manage: mode === 'manage',
    picked: [],
    confirming: false,
    projectId,
    editing: null,
  };
}

export function reduceServicesPanel(
  state: ServicesPanelState,
  action: ServicesPanelAction
): ServicesPanelState {
  switch (action.type) {
    case 'open':
      return createServicesPanel(action.mode, action.projectId);
    case 'custom':
      return { ...state, view: 'custom' };
    case 'back':
      if (state.view === 'custom') return { ...state, view: 'add' };
      return { ...state, view: 'list', editing: null };
    case 'done':
      return { ...state, view: 'list', editing: null };
    case 'manage':
      return { ...state, manage: action.on, picked: [], confirming: false };
    case 'pick':
      return { ...state, picked: action.picked, confirming: action.picked.length > 0 && state.confirming };
    case 'confirm':
      return { ...state, confirming: action.on };
    case 'removed':
      return { ...state, picked: [], confirming: false };
    case 'edit':
      return { ...state, view: 'edit', editing: action.serviceId, confirming: false };
    case 'project':
      return { ...state, projectId: action.projectId };
  }
}

export type ServicesPanelView = ServicesPanelState['view'];

export type ServicesPanelHeight = 'content' | 'fixed';

export function resolveShownServicesView(
  panel: ServicesPanelState,
  canAdd: boolean,
  canEdit: boolean
): ServicesPanelView {
  if ((panel.view === 'add' || panel.view === 'custom') && canAdd) return panel.view;
  if (panel.view === 'edit' && canEdit) return 'edit';
  return 'list';
}

export function resolveServicesPanelHeight(view: ServicesPanelView): ServicesPanelHeight {
  return view === 'list' ? 'content' : 'fixed';
}

export function listPickedServices(views: ServiceView[], picked: string[]): ServiceDefinition[] {
  return views.flatMap((view) => (picked.includes(view.service.id) ? [view.service] : []));
}

export function selectEditedService(views: ServiceView[], editing: string | null) {
  return views.find((view) => view.service.id === editing)?.service ?? null;
}

let pending: ServicesPanelMode | null = null;
const listeners = new Set<() => void>();

export function requestServicesPanel(mode: ServicesPanelMode) {
  pending = mode;
  for (const listener of listeners) listener();
}

export function useServicesPanelRequest(apply: (mode: ServicesPanelMode) => void) {
  const latest = React.useRef(apply);
  latest.current = apply;
  React.useEffect(() => {
    const consume = () => {
      if (pending === null) return;
      const mode = pending;
      pending = null;
      latest.current(mode);
    };
    consume();
    listeners.add(consume);
    return () => {
      listeners.delete(consume);
    };
  }, []);
}
