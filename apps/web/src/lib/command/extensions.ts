import type { ExtensionsSnapshot } from '@shinsa/core';
import { type Command, type CommandSection, RANK } from '@/lib/command/registry.ts';
import { openSettingsSection } from '@/lib/command/settings.ts';
import {
  chooseOptimizer,
  choosePlugin,
  chooseServer,
  chooseSkill,
  signInServer,
} from '@/lib/connection/extensions.ts';
import {
  describeServerToggled,
  EXTENSION_ICON,
  EXTENSION_LABEL,
  EXTENSION_SECTION,
  type ExtensionKind,
  isPluginOff,
  needsConnect,
  resolveAddServerPath,
} from '@/lib/extensions.ts';
import { navigate } from '@/router.ts';

const SECTION_KEYWORDS: Record<ExtensionKind, string[]> = {
  servers: ['mcp', 'servers', 'tools', 'integrations', 'connect'],
  plugins: ['claude code', 'plugins', 'hooks', 'agents'],
  skills: ['skills', 'claude code', 'codex'],
};

function createSectionCommand(kind: ExtensionKind): Command {
  return {
    kind: 'run',
    id: `extensions.${kind}`,
    label: EXTENSION_SECTION[kind],
    icon: EXTENSION_ICON[kind],
    keywords: SECTION_KEYWORDS[kind],
    run: () => openSettingsSection(EXTENSION_SECTION[kind]),
  };
}

function toggleLabel(enabled: boolean) {
  return enabled ? 'Turn off' : 'Turn on';
}

function listItemCommands(snapshot: ExtensionsSnapshot): Command[] {
  const commands: Command[] = [];
  for (const server of snapshot.servers) {
    if (needsConnect(server)) {
      commands.push({
        kind: 'run',
        id: `extensions.server.${server.id}.connect`,
        label: `Connect ${server.name}`,
        icon: 'IconUserKey',
        searchOnly: true,
        keywords: ['mcp', 'sign in', 'server'],
        run: () => void signInServer(server),
      });
    }
    if (isPluginOff(snapshot.plugins, server.plugin)) continue;
    commands.push({
      kind: 'run',
      id: `extensions.server.${server.id}.toggle`,
      label: `${toggleLabel(server.enabled)} ${server.name} for agents`,
      icon: EXTENSION_ICON.servers,
      searchOnly: true,
      keywords: ['mcp', 'server', 'enable', 'disable'],
      run: () =>
        void chooseServer(
          server,
          { enabled: !server.enabled },
          describeServerToggled(server.name, !server.enabled)
        ),
    });
  }
  for (const plugin of snapshot.plugins) {
    commands.push({
      kind: 'run',
      id: `extensions.plugin.${plugin.id}`,
      label: `${toggleLabel(plugin.enabled)} the ${plugin.name} plugin`,
      icon: EXTENSION_ICON.plugins,
      searchOnly: true,
      keywords: ['plugin', 'enable', 'disable'],
      run: () => void choosePlugin(plugin, !plugin.enabled),
    });
  }
  for (const skill of snapshot.skills) {
    if (skill.source === 'shinsa' || isPluginOff(snapshot.plugins, skill.plugin)) continue;
    commands.push({
      kind: 'run',
      id: `extensions.skill.${skill.id}`,
      label: `${toggleLabel(skill.enabled)} the ${skill.name} skill`,
      icon: EXTENSION_ICON.skills,
      searchOnly: true,
      keywords: ['skill', 'enable', 'disable'],
      run: () => void chooseSkill(skill, !skill.enabled),
    });
  }
  const { optimizer } = snapshot;
  commands.push({
    kind: 'run',
    id: 'extensions.optimizer',
    label: `${toggleLabel(optimizer.enabled)} the context optimizer`,
    icon: 'IconGauge',
    searchOnly: true,
    keywords: ['context', 'tokens', 'unused', 'mcp', 'skills', 'optimizer'],
    run: () => void chooseOptimizer(optimizer, { enabled: !optimizer.enabled }),
  });
  return commands;
}

export function listExtensionSections(snapshot: ExtensionsSnapshot | null): CommandSection[] {
  return [
    {
      id: 'global.extensions',
      heading: 'Integrations',
      rank: RANK.global + 5,
      commands: [
        {
          kind: 'run',
          id: 'extensions.add',
          label: EXTENSION_LABEL.addServerCommand,
          icon: 'IconPlusMedium',
          keywords: ['mcp', 'server', 'new', 'connect', 'integration'],
          run: () => navigate(resolveAddServerPath()),
        },
        createSectionCommand('servers'),
        createSectionCommand('plugins'),
        createSectionCommand('skills'),
        ...(snapshot ? listItemCommands(snapshot) : []),
      ],
    },
  ];
}
