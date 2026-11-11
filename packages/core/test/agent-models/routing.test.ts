import { describe, expect, test } from 'bun:test';
import {
  AUTO_MODEL,
  createSettings,
  isAutoModel,
  isModelUsable,
  type ModelRoom,
  resolveAgentModel,
  resolveChosenModel,
  resolveModelLabel,
  resolveRouteStep,
  resolveRoutedModel,
  resolveStepModel,
} from '../../src/index.ts';

const AUTO = { ...createSettings(), agentModels: { agent: AUTO_MODEL, reviewer: AUTO_MODEL } };

function room(...spent: string[]): Record<string, ModelRoom> {
  return Object.fromEntries(
    ['fable', 'opus', 'sonnet'].map((family) => [
      family,
      { family, usable: !spent.includes(family), left: spent.includes(family) ? 0 : 40, at: 0 },
    ])
  );
}

describe('the automatic model', () => {
  test('is kept as the choice but never handed to a run as a model', () => {
    expect(resolveChosenModel(AUTO, 'agent')).toBe(AUTO_MODEL);
    expect(resolveAgentModel(AUTO, 'agent')).toBe('opus');
    expect(resolveAgentModel({ ...AUTO, agentModels: { writer: AUTO_MODEL } }, 'writer')).toBe('sonnet');
    expect(resolveModelLabel(AUTO_MODEL)).toBe('Automatic');
  });

  test('applies only to a role that runs on Claude', () => {
    expect(isAutoModel(AUTO, 'agent')).toBe(true);
    expect(isAutoModel(AUTO, 'answerer')).toBe(false);
    expect(isAutoModel({ ...AUTO, agentProviders: { agent: 'codex' } }, 'agent')).toBe(false);
  });
});

describe('the route of a step', () => {
  test('only planning a large task routes to Fable first', () => {
    expect(resolveRouteStep({ size: 'large', role: 'agent', purpose: 'plan' })).toBe('plan_large');
    expect(resolveRouteStep({ size: 'large', role: 'planner', purpose: null })).toBe('plan_large');
    expect(resolveRouteStep({ size: 'small', role: 'agent', purpose: 'plan' })).toBe('plan');
    expect(resolveRouteStep({ size: null, role: 'agent', purpose: 'plan' })).toBe('plan');
    expect(resolveRouteStep({ size: 'large', role: 'agent', purpose: 'build' })).toBe('work');
    expect(resolveRouteStep({ size: 'large', role: 'reviewer', purpose: null })).toBe('work');
  });

  test('a large task plans on Fable and builds, fixes and reviews on Opus', () => {
    const large = { size: 'large' as const };
    expect(resolveRoutedModel({ ...large, role: 'agent', purpose: 'plan' }, room())).toBe('fable');
    expect(resolveRoutedModel({ ...large, role: 'agent', purpose: 'build' }, room())).toBe('opus');
    expect(resolveRoutedModel({ ...large, role: 'agent', purpose: 'fix' }, room())).toBe('opus');
    expect(resolveRoutedModel({ ...large, role: 'reviewer', purpose: null }, room())).toBe('opus');
  });

  test('a small task runs every step on Opus', () => {
    expect(resolveRoutedModel({ size: 'small', role: 'agent', purpose: 'plan' }, room())).toBe('opus');
    expect(resolveRoutedModel({ size: 'small', role: 'agent', purpose: 'build' }, room())).toBe('opus');
  });

  test('a model spent on every account is skipped, and Fable is never a fallback for building', () => {
    const plan = { size: 'large' as const, role: 'agent' as const, purpose: 'plan' as const };
    const build = { ...plan, purpose: 'build' as const };
    expect(resolveRoutedModel(plan, room('fable'))).toBe('opus');
    expect(resolveRoutedModel(build, room('opus'))).toBe('sonnet');
    expect(resolveRoutedModel(build, room('opus', 'sonnet'))).toBe('opus');
  });

  test('a model with no recorded room counts as usable, matched by its family', () => {
    expect(isModelUsable({}, 'fable')).toBe(true);
    expect(isModelUsable(room('fable'), 'claude-fable-5-1')).toBe(false);
  });
});

describe('the model a step starts on', () => {
  const plan = { size: 'large' as const, role: 'agent' as const, purpose: 'plan' as const, room: room() };

  test('is routed when the role’s model is Automatic', () => {
    expect(resolveStepModel({ ...plan, settings: AUTO })).toBe('fable');
  });

  test('is the chosen model otherwise', () => {
    const settings = { ...createSettings(), agentModels: { agent: 'sonnet' } };
    expect(resolveStepModel({ ...plan, settings })).toBe('sonnet');
    expect(resolveStepModel({ ...plan, settings: { ...AUTO, agentProviders: { agent: 'codex' } } })).toBe(
      'gpt-6-astra'
    );
  });
});
