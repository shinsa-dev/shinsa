import type { ShinsaState } from '@shinsa/core';
import { Input } from '@shinsa/ui/components/input';
import * as React from 'react';
import {
  EXTENSION_ACTIONS,
  useExtensions,
  useRefreshOnReturn,
  useServerCheck,
} from '@/lib/connection/extensions.ts';
import {
  ADD_SERVER_PARAM,
  ADD_SERVER_VALUE,
  EXTENSION_LABEL,
  EXTENSION_SECTION,
  filterExtensions,
  isEmptyMatch,
  resolveExtensionPlaces,
  resolvePathWithoutAdd,
  SEARCH_PARAM,
} from '@/lib/extensions.ts';
import { replaceRoute, updateSearchParams, useSearchParam } from '@/router.ts';
import { ContextOptimizerGroup } from './context-optimizer.tsx';
import { SettingsEmpty, SettingsGroup } from './group.tsx';
import { McpServersGroup } from './mcp-servers.tsx';
import { PluginsGroup } from './plugins.tsx';
import { SkillsGroup } from './skills.tsx';

export function IntegrationSettings({ state }: { state: ShinsaState }) {
  const { snapshot, failure } = useExtensions();
  const adding = useSearchParam(ADD_SERVER_PARAM) === ADD_SERVER_VALUE;
  const query = useSearchParam(SEARCH_PARAM) ?? '';
  const places = React.useMemo(() => resolveExtensionPlaces(state), [state]);
  const clearAdding = React.useCallback(() => replaceRoute(resolvePathWithoutAdd(location)), []);
  const matches = React.useMemo(() => snapshot && filterExtensions(snapshot, query), [snapshot, query]);
  useServerCheck();
  useRefreshOnReturn();
  if (!snapshot || !matches) {
    if (!failure) return null;
    return (
      <SettingsGroup title={EXTENSION_SECTION.servers}>
        <SettingsEmpty>{`${EXTENSION_LABEL.unreadable} ${failure}`}</SettingsEmpty>
      </SettingsGroup>
    );
  }
  const { searching } = matches;
  return (
    <>
      <div
        data-slot='integrations-search'
        className='sticky top-0 z-40 -mx-2 -mt-3 -mb-3 bg-background px-2 py-3'
      >
        <Input
          type='search'
          value={query}
          onChange={(event) =>
            updateSearchParams({ [SEARCH_PARAM]: event.target.value || null }, { replace: true })
          }
          placeholder={EXTENSION_LABEL.search}
          aria-label={EXTENSION_LABEL.search}
        />
      </div>
      {searching && isEmptyMatch(matches) && (
        <p className='px-1 text-xs text-fg-2'>{EXTENSION_LABEL.nothingMatches}</p>
      )}
      {!searching && <ContextOptimizerGroup snapshot={snapshot} actions={EXTENSION_ACTIONS} />}
      {(!searching || matches.servers.length > 0) && (
        <McpServersGroup
          snapshot={snapshot}
          servers={matches.servers}
          places={places}
          actions={EXTENSION_ACTIONS}
          adding={adding}
          onAddOpened={clearAdding}
          searching={searching}
        />
      )}
      <PluginsGroup
        snapshot={snapshot}
        plugins={matches.plugins}
        actions={EXTENSION_ACTIONS}
        searching={searching}
      />
      <SkillsGroup
        snapshot={snapshot}
        skills={matches.skills}
        places={places}
        actions={EXTENSION_ACTIONS}
        searching={searching}
      />
    </>
  );
}
