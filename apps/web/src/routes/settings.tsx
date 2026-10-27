import type { ShinsaState } from '@shinsa/core';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { Choice } from '@/components/controls/choice.tsx';
import { PAGE_COLUMN, PAGE_TOP } from '@/components/layout/page/column.ts';
import { PageHeading } from '@/components/layout/page/heading.tsx';
import { PageScroll } from '@/components/layout/page/page-scroll.tsx';
import { AccountSettings } from '@/components/settings/accounts.tsx';
import { AgentSettings } from '@/components/settings/agents.tsx';
import { AppearanceSettings } from '@/components/settings/appearance.tsx';
import { AttentionSettings } from '@/components/settings/attention.tsx';
import { ContextSettings } from '@/components/settings/context.tsx';
import { FolderSettings, SetupSettings } from '@/components/settings/folders.tsx';
import { IntegrationSettings } from '@/components/settings/integrations.tsx';
import { MemorySettings } from '@/components/settings/memory.tsx';
import { NotificationSettings } from '@/components/settings/notifications.tsx';
import { ProjectSettings } from '@/components/settings/projects.tsx';
import { ScheduleSettings } from '@/components/settings/schedules.tsx';
import { UpdateSettings } from '@/components/settings/updates.tsx';
import { LimitSettings } from '@/components/settings/usage.tsx';
import { VersionSettings } from '@/components/settings/versions.tsx';
import { useRegisterCommands } from '@/lib/command/registry.ts';
import { listSettingsSections } from '@/lib/command/settings.ts';
import { useAccounts } from '@/lib/connection/accounts.ts';
import { useExtensions } from '@/lib/connection/extensions.ts';
import { useAgentProviders } from '@/lib/connection/models.ts';
import { useOnboardingStatus } from '@/lib/connection/onboarding.ts';
import { useWorkspaceSupport } from '@/lib/connection/workspaces.ts';
import { readDesktopChannel, subscribeDesktopUpdate } from '@/lib/desktop.ts';
import { useExplorerSide } from '@/lib/preferences/code.ts';
import { useNotificationPreferences } from '@/lib/preferences/notifications.ts';
import { resolveHashSectionId } from '@/lib/settings.ts';
import {
  findSettingsTab,
  listSettingsTabs,
  resolveSettingsTab,
  resolveSettingsTabParam,
  type SettingsTabId,
} from '@/lib/settings-tabs.ts';
import { resolveRepoKey } from '@/lib/workspaces.ts';
import { updateSearchParams, useSearchParam } from '@/router.ts';

function useSectionScroll(
  scroller: React.RefObject<HTMLDivElement | null>,
  tab: SettingsTabId,
  ready: boolean
) {
  React.useEffect(() => {
    if (!ready) return;
    const id = resolveHashSectionId(location.hash);
    const section = id ? document.getElementById(id) : null;
    if (section) section.scrollIntoView({ block: 'start' });
    else scroller.current?.scrollTo({ top: 0 });
  }, [scroller, tab, ready]);
}

function isTabRead(tab: SettingsTabId, extensionsRead: boolean, foldersRead: boolean) {
  if (tab === 'integrations') return extensionsRead;
  if (tab === 'projects') return foldersRead;
  return true;
}

function TabSections({ state, tab }: { state: ShinsaState; tab: SettingsTabId }) {
  switch (tab) {
    case 'general':
      return (
        <>
          <AppearanceSettings />
          <AttentionSettings settings={state.settings} />
          <NotificationSettings />
          <ContextSettings settings={state.settings} />
          <SetupSettings />
          <UpdateSettings />
        </>
      );
    case 'agents':
      return (
        <>
          <AgentSettings settings={state.settings} />
          <MemorySettings state={state} />
          <VersionSettings />
        </>
      );
    case 'accounts':
      return (
        <>
          <AccountSettings settings={state.settings} />
          <LimitSettings settings={state.settings} />
        </>
      );
    case 'projects':
      return (
        <>
          <FolderSettings />
          <ProjectSettings state={state} />
        </>
      );
    case 'integrations':
      return <IntegrationSettings state={state} />;
    case 'automations':
      return <ScheduleSettings state={state} />;
  }
}

export function SettingsPage({ state }: { state: ShinsaState }) {
  const providers = useAgentProviders();
  const notifications = useNotificationPreferences();
  const accounts = useAccounts();
  const tab = resolveSettingsTab(useSearchParam('tab'), location.hash);
  const tabs = listSettingsTabs();
  const current = findSettingsTab(tab);
  const scroller = React.useRef<HTMLDivElement>(null);
  const repos = Object.values(state.repos);
  const support = useWorkspaceSupport(resolveRepoKey(repos));
  const explorerSide = useExplorerSide();
  const updateChannel = React.useSyncExternalStore(subscribeDesktopUpdate, readDesktopChannel);
  useRegisterCommands(
    listSettingsSections(
      state.settings,
      providers,
      notifications,
      accounts,
      { repos, support },
      explorerSide,
      updateChannel
    )
  );
  const extensions = useExtensions();
  const extensionsRead = extensions.snapshot !== null || extensions.failure !== null;
  const foldersRead = useOnboardingStatus() !== null;
  useSectionScroll(scroller, tab, accounts !== null && isTabRead(tab, extensionsRead, foldersRead));
  const openTab = (next: SettingsTabId) => updateSearchParams({ tab: resolveSettingsTabParam(next) });

  return (
    <PageScroll viewportRef={scroller}>
      <div className={cn(PAGE_COLUMN, PAGE_TOP, 'flex flex-col gap-6 pb-12')}>
        <div className='flex flex-col gap-3'>
          <PageHeading title={current.label} />
          <Choice<SettingsTabId>
            label='Settings sections'
            items={tabs.map((entry) => ({ value: entry.id, label: entry.label }))}
            value={tab}
            onValueChange={openTab}
          />
        </div>
        <TabSections state={state} tab={tab} />
      </div>
    </PageScroll>
  );
}
