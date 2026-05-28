const TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

export class GraphAuthError extends Error {
  readonly status: number;
  readonly body: string;
  constructor(status: number, body: string) {
    super(`Graph auth failed: ${status}`);
    this.name = 'GraphAuthError';
    this.status = status;
    this.body = body;
  }
}

export interface GraphTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
  readonly grantedScopes: readonly string[];
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

function parseTokenResponse(raw: TokenResponse, fallbackRefresh?: string): GraphTokens {
  return {
    accessToken: raw.access_token,
    refreshToken: raw.refresh_token ?? fallbackRefresh ?? '',
    expiresAt: new Date(Date.now() + raw.expires_in * 1000),
    grantedScopes: (raw.scope ?? '').split(/\s+/).filter(Boolean),
  };
}

export async function exchangeCodeForTokens(params: {
  readonly code: string;
  readonly redirectUri: string;
  readonly clientId: string;
  readonly clientSecret: string;
}): Promise<GraphTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new GraphAuthError(res.status, await res.text().catch(() => ''));
  }
  const json = (await res.json()) as TokenResponse;
  return parseTokenResponse(json);
}

export async function refreshTokens(params: {
  readonly refreshToken: string;
  readonly clientId: string;
  readonly clientSecret: string;
}): Promise<GraphTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!res.ok) {
    throw new GraphAuthError(res.status, await res.text().catch(() => ''));
  }
  const json = (await res.json()) as TokenResponse;
  return parseTokenResponse(json, params.refreshToken);
}
