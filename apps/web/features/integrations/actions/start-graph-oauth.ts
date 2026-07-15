'use server';
import 'server-only';
import { randomBytes } from 'node:crypto';
import { redirect } from 'next/navigation';
import { prisma } from '@nexushub/db';
import { requireUser } from '@/lib/auth';
import { signOAuthState } from '@/lib/oauth/state';
import { getServerEnv } from '@/lib/env';

const AUTHORIZE_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const SCOPES = 'offline_access User.Read Mail.Read';
const STATE_TTL_MS = 10 * 60 * 1000;

function callbackUrl(): string {
  const base = getServerEnv().APP_URL ?? 'http://localhost:3000';
  return `${base.replace(/\/$/, '')}/api/oauth/graph/callback`;
}

export async function startGraphOAuth(): Promise<never> {
  const ctx = await requireUser();
  const env = getServerEnv();
  const nonce = randomBytes(16).toString('hex');
  const expSec = Math.floor((Date.now() + STATE_TTL_MS) / 1000);
  const state = signOAuthState({
    workspaceId: ctx.workspaceId,
    userId: ctx.userId,
    nonce,
    returnTo: '/integrations',
    exp: expSec,
  });
  await prisma.oAuthState.create({
    data: {
      state,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      kind: 'graph',
      returnTo: '/integrations',
      expiresAt: new Date(expSec * 1000),
    },
  });
  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('client_id', env.GRAPH_CLIENT_ID ?? '');
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', callbackUrl());
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('response_mode', 'query');
  // Force the account picker even when the browser has an active MS session:
  // without this Microsoft silently reuses the last logged-in account, so a
  // user who already connected one mailbox can't choose a different one from
  // the same browser without going to logout.live.com first.
  url.searchParams.set('prompt', 'select_account');
  redirect(url.toString());
}
