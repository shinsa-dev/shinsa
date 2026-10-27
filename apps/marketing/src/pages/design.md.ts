import { ICON_NAMES } from '@shinsa/ui/components/icon';
import kitStylesheet from '@shinsa/ui/styles/globals.css?raw';
import type { APIRoute } from 'astro';
import tailwindTheme from 'tailwindcss/theme.css?raw';
import source from '../../../../docs/design-system.md?raw';
import { CUSTOM_ICON_PATHS } from '../../../../packages/ui/src/components/icon/custom.ts';
import * as lintRules from '../../../../scripts/lint-rules.ts';
import appStylesheet from '../../../web/src/app.css?raw';
import desktopStylesheet from '../../../web/src/desktop.css?raw';
import { serializeDesign } from '../lib/design';

export const GET: APIRoute = () =>
  new Response(
    serializeDesign({
      source,
      kitStylesheet,
      webStylesheets: [
        { name: 'app.css', css: appStylesheet },
        { name: 'desktop.css', css: desktopStylesheet },
      ],
      tailwindTheme,
      iconNames: ICON_NAMES,
      customIconNames: Object.keys(CUSTOM_ICON_PATHS),
      lint: lintRules,
    }),
    { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } }
  );
