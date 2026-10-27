import * as React from 'react';
import { scopeSelectAll } from '../lib/selection';

/** Mount once at the app root: ⌘A selects a content region, never the page. */
export function useSelectAllScope() {
  React.useEffect(() => {
    window.addEventListener('keydown', scopeSelectAll);
    return () => window.removeEventListener('keydown', scopeSelectAll);
  }, []);
}
