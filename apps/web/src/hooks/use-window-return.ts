import * as React from 'react';

export function useWindowReturn(onReturn: () => void, active: boolean) {
  const latest = React.useRef(onReturn);
  latest.current = onReturn;
  React.useEffect(() => {
    if (!active) return;
    let away = document.visibilityState === 'hidden' || !document.hasFocus();
    const leave = () => {
      away = true;
    };
    const arrive = () => {
      if (!away || document.visibilityState === 'hidden') return;
      away = false;
      latest.current();
    };
    window.addEventListener('blur', leave);
    window.addEventListener('focus', arrive);
    document.addEventListener('visibilitychange', arrive);
    return () => {
      window.removeEventListener('blur', leave);
      window.removeEventListener('focus', arrive);
      document.removeEventListener('visibilitychange', arrive);
    };
  }, [active]);
}
