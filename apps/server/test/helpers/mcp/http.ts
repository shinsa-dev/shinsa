import { createHash } from 'node:crypto';

interface FakeMcpHttpOptions {
  port?: number;
  oauth?: boolean;
  expiresIn?: number;
  tokenError?: string;
  tools?: { name: string; description: string }[];
}

export interface FakeMcpHttp {
  url: string;
  mcpUrl: string;
  issued: string[];
  refreshed: number;
  authorizeUrls: string[];
  requests: { path: string; authorization: string | null }[];
  stop: () => Promise<void>;
}

interface PendingCode {
  challenge: string;
  redirectUri: string;
}

type Rpc = { id?: number | string; method?: string; params?: Record<string, unknown> };

const DEFAULT_TOOLS = [{ name: 'lookup', description: 'Looks a thing up.' }];

function resolveChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

export function startFakeMcpHttp(options: FakeMcpHttpOptions = {}): FakeMcpHttp {
  const codes = new Map<string, PendingCode>();
  const refreshTokens = new Set<string>();
  const state: Omit<FakeMcpHttp, 'url' | 'mcpUrl' | 'stop'> = {
    issued: [],
    refreshed: 0,
    authorizeUrls: [],
    requests: [],
  };
  let counter = 0;

  const issue = () => {
    counter += 1;
    const access = `access-${counter}`;
    const refresh = `refresh-${counter}`;
    state.issued.push(access);
    refreshTokens.add(refresh);
    return Response.json({
      access_token: access,
      refresh_token: refresh,
      token_type: 'Bearer',
      expires_in: options.expiresIn ?? 3600,
    });
  };

  const answerRpc = (message: Rpc) => {
    if (message.id === undefined) return null;
    if (message.method === 'initialize') {
      return {
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: message.params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake-http', version: '1.0.0' },
        },
      };
    }
    if (message.method === 'tools/list') {
      const tools = (options.tools ?? DEFAULT_TOOLS).map((tool) => ({
        ...tool,
        inputSchema: { type: 'object', properties: {} },
      }));
      return { jsonrpc: '2.0', id: message.id, result: { tools } };
    }
    return { jsonrpc: '2.0', id: message.id, result: {} };
  };

  const describeMetadata = (base: string) =>
    Response.json({
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
    });

  const authorize = (address: URL) => {
    state.authorizeUrls.push(address.toString());
    const code = `code-${codes.size + 1}`;
    const redirectUri = address.searchParams.get('redirect_uri') ?? '';
    codes.set(code, { challenge: address.searchParams.get('code_challenge') ?? '', redirectUri });
    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', address.searchParams.get('state') ?? '');
    return Response.redirect(target.toString(), 302);
  };

  const refresh = (form: URLSearchParams) => {
    if (!refreshTokens.delete(form.get('refresh_token') ?? '')) {
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    state.refreshed += 1;
    return issue();
  };

  const exchange = async (request: Request) => {
    const form = new URLSearchParams(await request.text());
    if (options.tokenError) return Response.json({ error: options.tokenError }, { status: 400 });
    if (form.get('grant_type') === 'refresh_token') return refresh(form);
    const pending = codes.get(form.get('code') ?? '');
    if (!pending || resolveChallenge(form.get('code_verifier') ?? '') !== pending.challenge) {
      return Response.json({ error: 'invalid_grant' }, { status: 400 });
    }
    codes.delete(form.get('code') ?? '');
    return issue();
  };

  const answerMcp = async (request: Request, base: string, authorization: string | null) => {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const token = authorization?.replace(/^Bearer /, '') ?? '';
    if (options.oauth && !state.issued.includes(token)) {
      return new Response('Unauthorized', {
        status: 401,
        headers: {
          'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
        },
      });
    }
    const answer = answerRpc((await request.json()) as Rpc);
    if (!answer) return new Response(null, { status: 202 });
    return Response.json(answer);
  };

  const routes: Record<string, (request: Request, address: URL) => Response | Promise<Response>> = {
    '/.well-known/oauth-protected-resource/mcp': (_request, address) =>
      Response.json({ resource: `${address.origin}/mcp`, authorization_servers: [address.origin] }),
    '/.well-known/oauth-protected-resource': (_request, address) =>
      Response.json({ resource: `${address.origin}/mcp`, authorization_servers: [address.origin] }),
    '/.well-known/oauth-authorization-server': (_request, address) => describeMetadata(address.origin),
    '/register': async (request) => {
      const body = (await request.json()) as Record<string, unknown>;
      return Response.json({ ...body, client_id: 'fake-client' }, { status: 201 });
    },
    '/authorize': (_request, address) => authorize(address),
    '/token': (request) => exchange(request),
    '/mcp': (request, address) => answerMcp(request, address.origin, request.headers.get('authorization')),
  };

  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: '127.0.0.1',
    fetch: (request) => {
      const address = new URL(request.url);
      state.requests.push({ path: address.pathname, authorization: request.headers.get('authorization') });
      const route = routes[address.pathname];
      return route ? route(request, address) : new Response('Not found', { status: 404 });
    },
  });

  const url = `http://127.0.0.1:${server.port}`;
  return Object.assign(state, {
    url,
    mcpUrl: `${url}/mcp`,
    stop: () => server.stop(true),
  });
}
