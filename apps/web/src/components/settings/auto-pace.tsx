import { MINUTE_MS, type Project, resolveAutoPace, type ShinsaState } from '@shinsa/core';
import { Icon } from '@shinsa/ui/components/icon';
import { Switch } from '@shinsa/ui/components/switch';
import { Truncate } from '@shinsa/ui/components/truncate';
import { cn } from '@shinsa/ui/lib/utils';
import * as React from 'react';
import { HintButton } from '@/components/controls/hint-button.tsx';
import { ProjectDotIcon } from '@/components/status/project-dot.tsx';
import { useMinute } from '@/hooks/use-minute.ts';
import {
  AUTO_PACE_LABEL,
  listPaceBudgets,
  listRankedProjects,
  moveProject,
  type PaceBudgetRow,
  shiftProject,
} from '@/lib/accounts/auto-pace.ts';
import { useEngineFeature } from '@/lib/connection/socket.ts';
import { updateSettings } from '@/lib/settings.ts';
import { SETTING_ROW, SETTINGS_SUBHEADING, SettingRow, SettingsEmpty, SettingsGroup } from './group.tsx';

function BudgetRow({ row }: { row: PaceBudgetRow }) {
  return (
    <div className={SETTING_ROW}>
      <div className='flex min-w-0 flex-1 flex-col'>
        <Truncate className='text-xs text-fg-4'>{row.label}</Truncate>
        <span className='text-2xs text-fg-2'>{row.detail}</span>
      </div>
      <span className='shrink-0 text-xs text-fg-3 tabular-nums'>{row.value}</span>
    </div>
  );
}

function saveOrder(order: string[]) {
  return updateSettings({ projectOrder: order }, AUTO_PACE_LABEL.moved);
}

function ProjectRankRow({
  project,
  rank,
  order,
  dragging,
  onDragStart,
  onDrop,
}: {
  project: Project;
  rank: number;
  order: string[];
  dragging: boolean;
  onDragStart: () => void;
  onDrop: () => void;
}) {
  return (
    <div
      draggable
      data-dragging={dragging || undefined}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move';
        onDragStart();
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className={cn(SETTING_ROW, 'cursor-grab gap-2 data-dragging:opacity-50')}
    >
      <Icon size='sm' name='IconDotGrid2x3' className='shrink-0 text-fg-2' />
      <span className='w-4 shrink-0 text-2xs text-fg-2 tabular-nums'>{rank}</span>
      <ProjectDotIcon color={project.color} />
      <Truncate className='min-w-0 flex-1 text-xs text-fg-4'>{project.name}</Truncate>
      <HintButton
        label={AUTO_PACE_LABEL.moveUp}
        icon='IconArrowUp'
        size='icon-xs'
        disabled={rank === 1}
        onClick={() => void saveOrder(shiftProject(order, project.id, -1))}
      />
      <HintButton
        label={AUTO_PACE_LABEL.moveDown}
        icon='IconArrowDown'
        size='icon-xs'
        disabled={rank === order.length}
        onClick={() => void saveOrder(shiftProject(order, project.id, 1))}
      />
    </div>
  );
}

function ProjectOrder({ state }: { state: ShinsaState }) {
  const projects = listRankedProjects(state);
  const order = projects.map((project) => project.id);
  const [dragged, setDragged] = React.useState<string | null>(null);
  if (projects.length < 2) return null;
  return (
    <>
      <div className={SETTINGS_SUBHEADING}>{AUTO_PACE_LABEL.projectOrder}</div>
      {projects.map((project, index) => (
        <ProjectRankRow
          key={project.id}
          project={project}
          rank={index + 1}
          order={order}
          dragging={project.id === dragged}
          onDragStart={() => setDragged(project.id)}
          onDrop={() => {
            if (dragged && dragged !== project.id) void saveOrder(moveProject(order, dragged, project.id));
            setDragged(null);
          }}
        />
      ))}
      <SettingsEmpty>{AUTO_PACE_LABEL.projectOrderHint}</SettingsEmpty>
    </>
  );
}

export function AutoPaceSettings({ state }: { state: ShinsaState }) {
  const available = useEngineFeature('usage.auto_pace');
  const minute = useMinute();
  const on = resolveAutoPace(state.settings);
  const budgets = React.useMemo(() => listPaceBudgets(state, minute * MINUTE_MS), [state, minute]);
  if (!available) return null;
  return (
    <SettingsGroup title={AUTO_PACE_LABEL.title} description={AUTO_PACE_LABEL.description}>
      <SettingRow title={AUTO_PACE_LABEL.toggle}>
        <Switch
          checked={on}
          aria-label={AUTO_PACE_LABEL.toggle}
          onCheckedChange={(autoPace) =>
            void updateSettings(
              { autoPace },
              autoPace ? AUTO_PACE_LABEL.toggled.on : AUTO_PACE_LABEL.toggled.off
            )
          }
        />
      </SettingRow>
      {on && budgets.map((row) => <BudgetRow key={row.provider} row={row} />)}
      {on && budgets.length === 0 && <SettingsEmpty>{AUTO_PACE_LABEL.noPace}</SettingsEmpty>}
      {on && <ProjectOrder state={state} />}
    </SettingsGroup>
  );
}
