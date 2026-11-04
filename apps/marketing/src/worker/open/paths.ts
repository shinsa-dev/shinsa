export function isOpenPage(pathname: string) {
  return pathname.replace(/\/+$/, '') === '/open';
}
