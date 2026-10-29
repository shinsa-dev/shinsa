import { describe, expect, it, mock } from 'bun:test';
import { resolveServiceView } from '@shinsa/core';
import { act, renderHook } from '@testing-library/react';
import {
  createServicesPanel,
  listPickedServices,
  reduceServicesPanel,
  requestServicesPanel,
  resolveServicesPanelHeight,
  resolveShownServicesView,
  type ServicesPanelAction,
  type ServicesPanelState,
  selectEditedService,
  useServicesPanelRequest,
} from '@/lib/terminal/services-panel.ts';
import { NOW } from '../../support/state.ts';
import { createService } from '../../support/terminals.ts';

function run(state: ServicesPanelState, ...actions: ServicesPanelAction[]) {
  return actions.reduce(reduceServicesPanel, state);
}

describe('the Services popover’s views', () => {
  it('opens on the list, in Manage, or on Add services when there is a project to add to', () => {
    expect(createServicesPanel('list', null)).toMatchObject({ view: 'list', manage: false });
    expect(createServicesPanel('manage', 'shop')).toMatchObject({ view: 'list', manage: true });
    expect(createServicesPanel('add', 'shop')).toMatchObject({ view: 'add', projectId: 'shop' });
    expect(createServicesPanel('add', null).view).toBe('list');
    const reopened = run(createServicesPanel('manage', null), {
      type: 'open',
      mode: 'add',
      projectId: 'shop',
    });
    expect(reopened).toEqual(createServicesPanel('add', 'shop'));
  });

  it('goes from Add services to the custom form and back, and to the list once added', () => {
    const add = createServicesPanel('add', 'shop');
    const custom = run(add, { type: 'custom' });
    expect(custom.view).toBe('custom');
    expect(run(custom, { type: 'back' }).view).toBe('add');
    expect(run(custom, { type: 'back' }, { type: 'back' }).view).toBe('list');
    expect(run(custom, { type: 'done' }).view).toBe('list');
    expect(run(add, { type: 'project', projectId: 'blog' }).projectId).toBe('blog');
  });

  it('ticks services in Manage, asks before removing them, and edits one without losing the ticks', () => {
    const manage = createServicesPanel('manage', null);
    const picked = run(manage, { type: 'pick', picked: ['api', 'web'] }, { type: 'confirm', on: true });
    expect(picked).toMatchObject({ picked: ['api', 'web'], confirming: true });
    expect(run(picked, { type: 'pick', picked: ['api'] }).confirming).toBe(true);
    expect(run(picked, { type: 'pick', picked: [] }).confirming).toBe(false);
    expect(run(picked, { type: 'confirm', on: false }).confirming).toBe(false);
    expect(run(picked, { type: 'removed' })).toMatchObject({ picked: [], confirming: false, manage: true });
    const editing = run(picked, { type: 'edit', serviceId: 'api' });
    expect(editing).toMatchObject({ view: 'edit', editing: 'api', confirming: false });
    expect(run(editing, { type: 'back' })).toMatchObject({
      view: 'list',
      editing: null,
      manage: true,
      picked: ['api', 'web'],
    });
    expect(run(picked, { type: 'manage', on: false })).toMatchObject({ manage: false, picked: [] });
  });

  it('finds the ticked and the edited services among those still there', () => {
    const views = ['api', 'web'].map((id) => resolveServiceView(createService({ id }), null, NOW));
    expect(listPickedServices(views, ['web', 'gone']).map((service) => service.id)).toEqual(['web']);
    expect(selectEditedService(views, 'api')?.id).toBe('api');
    expect(selectEditedService(views, 'gone')).toBeNull();
    expect(selectEditedService(views, null)).toBeNull();
  });

  it('shows a view only when it has what it needs, else the list', () => {
    const add = createServicesPanel('add', 'shop');
    expect(resolveShownServicesView(add, true, false, false)).toBe('add');
    expect(resolveShownServicesView(add, false, false, false)).toBe('list');
    expect(resolveShownServicesView(run(add, { type: 'custom' }), true, false, false)).toBe('custom');
    const edit = run(createServicesPanel('manage', null), { type: 'edit', serviceId: 'api' });
    expect(resolveShownServicesView(edit, false, true, false)).toBe('edit');
    expect(resolveShownServicesView(edit, false, false, false)).toBe('list');
    expect(resolveShownServicesView(createServicesPanel('manage', null), true, true, false)).toBe('list');
  });

  it('shows what was found when the project has no services yet, unless managing or nothing can be added', () => {
    const list = createServicesPanel('list', null);
    expect(resolveShownServicesView(list, true, false, true)).toBe('found');
    expect(resolveShownServicesView(list, false, false, true)).toBe('list');
    expect(resolveShownServicesView(createServicesPanel('manage', null), true, false, true)).toBe('list');
    expect(resolveShownServicesView(createServicesPanel('add', 'shop'), true, false, true)).toBe('add');
  });

  it('sizes the list to what it lists and keeps the forms at one height while they change', () => {
    expect(resolveServicesPanelHeight('list')).toBe('content');
    expect(resolveServicesPanelHeight('add')).toBe('fixed');
    expect(resolveServicesPanelHeight('custom')).toBe('fixed');
    expect(resolveServicesPanelHeight('edit')).toBe('fixed');
    expect(resolveServicesPanelHeight('found')).toBe('fixed');
  });

  it('hands a request from the command menu to the popover, even one made before it was there', () => {
    requestServicesPanel('manage');
    const opened = mock((_mode: string) => undefined);
    const view = renderHook(() => useServicesPanelRequest(opened));
    expect(opened).toHaveBeenCalledWith('manage');
    act(() => requestServicesPanel('add'));
    expect(opened.mock.calls.map(([mode]) => mode)).toEqual(['manage', 'add']);
    view.unmount();
    requestServicesPanel('list');
    expect(opened).toHaveBeenCalledTimes(2);
    renderHook(() => useServicesPanelRequest(() => undefined));
  });
});
