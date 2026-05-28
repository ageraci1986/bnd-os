import { NextResponse } from 'next/server';
import { prisma } from '@nexushub/db';
import { exchangeCodeForTokens, graphFetch } from '@nexushub/integrations/graph';
import { encryptSecret } from '@/lib/oauth/crypto';
import { verifyOAuthState, OAuthStateError } from '@/lib/oauth/state';
import { getServerEnv } from '@/lib/env';

const GRAPH_ME = 'https://graph.microsoft.com/v1.0/me';

function appUrl(): string {
  return (getServerEnv().APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

function callbackUrl(): string {
  return `${appUrl()}/api/oauth/graph/callback`;
}

function errorRedirect(code: string): NextResponse {
  return NextResponse.redirect(`${appUrl()}/integrations?error=${encodeURIComponent(code)}`, {
    status: 302,
  });
}

interface GraphMe {
  readonly mail?: string;
  readonly userPrincipalName?: string;
  readonly id?: string;
}

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    return new NextResponse('Missing code or state', { status: 400 });
  }

  let payload;
  try {
    payload = verifyOAuthState(state);
  } catch (err) {
    // Use name-based check so mock classes in tests match without sharing prototype chain.
    if (
      err instanceof OAuthStateError ||
      (err instanceof Error && err.name === 'OAuthStateError')
    ) {
      return new NextResponse('Invalid state', { status: 400 });
    }
    throw err;
  }

  const row = await prisma.oAuthState.findUnique({ where: { state } });
  if (
    !row ||
    row.consumedAt ||
    row.expiresAt.getTime() < Date.now() ||
    row.workspaceId !== payload.workspaceId ||
    row.userId !== payload.userId
  ) {
    return new NextResponse('Invalid or expired state', { status: 400 });
  }

  await prisma.oAuthState.update({
    where: { state },
    data: { consumedAt: new Date() },
  });

  const env = getServerEnv();
  let tokens;
  let me: GraphMe;
  try {
    tokens = await exchangeCodeForTokens({
      code,
      redirectUri: callbackUrl(),
      clientId: env.GRAPH_CLIENT_ID ?? '',
      clientSecret: env.GRAPH_CLIENT_SECRET ?? '',
    });
    me = await graphFetch<GraphMe>(GRAPH_ME, { token: tokens.accessToken });
  } catch {
    return errorRedirect('token_exchange_failed');
  }

  // SECURITY: never log accessToken, refreshToken, or ciphertext.
  const ciphertext = encryptSecret(
    JSON.stringify({
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt.toISOString(),
      grantedScopes: tokens.grantedScopes,
    }),
  );

  const externalLabel = me.mail ?? me.userPrincipalName ?? '';
  await prisma.integration.upsert({
    where: {
      workspaceId_kind_ownerUserId_externalAccountId: {
        workspaceId: payload.workspaceId,
        kind: 'graph',
        ownerUserId: payload.userId,
        externalAccountId: me.id ?? externalLabel,
      },
    },
    create: {
      workspaceId: payload.workspaceId,
      ownerUserId: payload.userId,
      kind: 'graph',
      scope: 'user',
      status: 'active',
      externalAccountId: me.id ?? externalLabel,
      externalAccountLabel: externalLabel,
      encryptedTokens: ciphertext,
      keyVersion: env.ENCRYPTION_KEY_VERSION,
      grantedScopes: [...tokens.grantedScopes],
      expiresAt: tokens.expiresAt,
      lastError: null,
    },
    update: {
      status: 'active',
      encryptedTokens: ciphertext,
      keyVersion: env.ENCRYPTION_KEY_VERSION,
      grantedScopes: [...tokens.grantedScopes],
      externalAccountLabel: externalLabel,
      expiresAt: tokens.expiresAt,
      lastError: null,
    },
  });

  // SECURITY: audit log must be PII-safe — no tokens, no email content.
  await prisma.auditLog.create({
    data: {
      workspaceId: payload.workspaceId,
      actorId: payload.userId,
      action: 'integration_connected',
      data: { kind: 'graph' },
    },
  });

  return NextResponse.redirect(`${appUrl()}/integrations?connected=graph`, { status: 302 });
}
