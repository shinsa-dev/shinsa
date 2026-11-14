import { Button } from '@shinsa/ui/components/button';
import {
  applyDesktopLocalEngine,
  applyDesktopMachine,
  type DesktopSource,
  selectDesktopSource,
} from '@/lib/desktop.ts';
import { describeDesktopSource, VIEWER_COPY } from '@/lib/remote/viewer-mode.ts';
import { DescribedRow, SettingsGroup } from './group.tsx';

export interface EngineSourceActions {
  pickLocal: () => void;
  pickMachine: () => void;
}

const ENGINE_SOURCE_ACTIONS: EngineSourceActions = {
  pickLocal: applyDesktopLocalEngine,
  pickMachine: () => applyDesktopMachine(null),
};

export function EngineSourceGroup({
  source,
  actions,
}: {
  source: DesktopSource;
  actions: EngineSourceActions;
}) {
  const shown = describeDesktopSource(source);
  return (
    <SettingsGroup title={VIEWER_COPY.settingsTitle} description={VIEWER_COPY.settingsDescription}>
      <DescribedRow title={shown.title} description={shown.detail}>
        {source.kind === 'local' ? (
          <Button variant='secondary' size='sm' onClick={actions.pickMachine}>
            {VIEWER_COPY.chooseMachine}
          </Button>
        ) : (
          <>
            {source.machine && (
              <Button variant='secondary' size='sm' onClick={actions.pickMachine}>
                {VIEWER_COPY.chooseAnother}
              </Button>
            )}
            <Button variant='secondary' size='sm' onClick={actions.pickLocal}>
              {VIEWER_COPY.useLocal}
            </Button>
          </>
        )}
      </DescribedRow>
    </SettingsGroup>
  );
}

export function EngineSourceSettings() {
  const source = selectDesktopSource();
  if (!source) return null;
  return <EngineSourceGroup source={source} actions={ENGINE_SOURCE_ACTIONS} />;
}
