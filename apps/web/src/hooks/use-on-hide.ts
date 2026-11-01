import * as React from 'react';

export function useOnHide(onHide: () => void) {
  const latest = React.useRef(onHide);
  React.useLayoutEffect(() => {
    latest.current = onHide;
  });
  React.useLayoutEffect(() => () => latest.current(), []);
}
