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
      <Input
        type='search'
        value={query}
        onChange={(event) =>
          updateSearchParams({ [SEARCH_PARAM]: event.target.value || null }, { replace: true })
        }
        placeholder={EXTENSION_LABEL.search}
        aria-label={EXTENSION_LABEL.search}
      />
      {searching && isEmptyMatch(matches) && (
        <p className='px-1 text-fg-2 text-xs'>{EXTENSION_LABEL.nothingMatches}</p>
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
