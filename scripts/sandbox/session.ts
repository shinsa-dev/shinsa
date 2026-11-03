import {
  type NativeSignInTokenResponse,
  REMOTE_NATIVE_CLIENT,
  REMOTE_NATIVE_REDIRECT_SCHEMES,
  REMOTE_PATHS,
} from '../../packages/core/src/index.ts';
import { readPreviewUser } from './requests.ts';
import { AS_COOKIE, GUEST, ORIGIN, USER } from './schema.ts';

function respondNativeSignIn(url: URL) {
  const redirect = URL.parse(url.searchParams.get('redirect') ?? '');
  if (!redirect || !REMOTE_NATIVE_REDIRECT_SCHEMES.some((scheme) => scheme === redirect.protocol))
    return Response.json(
      {
        error: { code: 'invalid_redirect', message: 'The app can only be sent back to a shinsa:// address.' },
      },
      { status: 400 }
    );
  redirect.searchParams.set('code', 'preview');
  return new Response(null, { status: 302, headers: { location: redirect.toString() } });
}

export function respondSignInAs(login: string, url: URL) {
  const user = login === GUEST.login ? GUEST : USER;
  const back = url.searchParams.get('return') ?? '';
  const location = back.startsWith('/') && !back.startsWith('//') ? back : REMOTE_PATHS.app;
  return new Response(null, {
    status: 302,
    headers: { location, 'set-cookie': `${AS_COOKIE}=${user.login}; Path=/; SameSite=Lax` },
  });
}

export function respondSession(request: Request, url: URL) {
  const { pathname } = url;
  const user = readPreviewUser(request);
  if (pathname === REMOTE_PATHS.session) return Response.json({ user });
  if (pathname === REMOTE_PATHS.signIn && url.searchParams.get('client') === REMOTE_NATIVE_CLIENT)
    return respondNativeSignIn(url);
  if (pathname === REMOTE_PATHS.signInToken && request.method === 'POST') {
    const answer: NativeSignInTokenResponse = { token: 'preview', user: USER };
    return Response.json(answer);
  }
  if (pathname === REMOTE_PATHS.signIn)
    return Response.redirect(`${ORIGIN}${url.searchParams.get('return') ?? REMOTE_PATHS.app}`, 302);
  if (pathname === REMOTE_PATHS.signOut) return Response.json({});
  return null;
}
