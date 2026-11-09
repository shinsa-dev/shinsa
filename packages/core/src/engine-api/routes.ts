import { Context } from 'effect';
import { HttpApi } from 'effect/http-api';
import { ENGINE_FEATURES, type EngineFeature } from '../protocol/engine.ts';
import { EngineApi } from './api.ts';
import {
  BrowserOnlyRoute,
  EngineFeatureRoute,
  type EngineRoute,
  GuestRoute,
  LocalOnlyRoute,
  OwnerOnlyRoute,
  RequestBodyLimit,
  RouteFieldFailures,
  SharedMemberRoute,
} from './schema.ts';

export function resolveEngineRouteKey(method: string, path: string) {
  const pattern = path
    .split('/')
    .map((segment) => {
      if (segment === '*') return '(.+)';
      return segment.startsWith(':') ? '([^/]+)' : segment;
    })
    .join('/');
  return `${method} ${pattern}`;
}

export function listEngineRoutes(): readonly EngineRoute[] {
  const routes: EngineRoute[] = [];
  HttpApi.reflect(EngineApi, {
    onGroup: () => undefined,
    onEndpoint: ({ group, endpoint, mergedAnnotations }) =>
      routes.push({
        group: group.identifier,
        name: endpoint.name,
        method: endpoint.method,
        path: endpoint.path,
        key: resolveEngineRouteKey(endpoint.method, endpoint.path),
        feature: Context.get(mergedAnnotations, EngineFeatureRoute),
        localOnly: Context.get(mergedAnnotations, LocalOnlyRoute),
        ownerOnly: Context.get(mergedAnnotations, OwnerOnlyRoute),
        sharedMember: Context.get(mergedAnnotations, SharedMemberRoute),
        guest: Context.get(mergedAnnotations, GuestRoute),
        browserOnly: Context.get(mergedAnnotations, BrowserOnlyRoute),
        bodyLimit: Context.get(mergedAnnotations, RequestBodyLimit),
        fieldFailures: Context.get(mergedAnnotations, RouteFieldFailures),
      }),
  });
  return routes;
}

export function resolveEngineFeatureRoutes(routes: readonly EngineRoute[] = listEngineRoutes()) {
  const byFeature = Object.fromEntries(ENGINE_FEATURES.map((feature) => [feature, [] as string[]])) as Record<
    EngineFeature,
    string[]
  >;
  for (const route of routes) if (route.feature) byFeature[route.feature].push(route.key);
  return byFeature;
}

export function listEngineBaselineRoutes(routes: readonly EngineRoute[] = listEngineRoutes()) {
  return routes.filter((route) => route.feature === null).map((route) => route.key);
}
