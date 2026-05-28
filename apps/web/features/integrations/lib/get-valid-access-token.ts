import 'server-only';
import { prisma } from '@nexushub/db';
import { refreshTokens } from '@nexushub/integrations/graph';
import { encryptSecret, decryptSecret } from '@/lib/oauth/crypto';
import { getServerEnv } from '@/lib/env';

interface StoredTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: string;
  readonly grantedScopes: readonly string[];
}

const REFRESH_LEAD_MS = 60_000;

export async function getValidAccessToken(integrationId: string): Promise<string> {
  const integration = await prisma.integration.findUnique({
    where: { id: integrationId },
    select: { id: true, encryptedTokens: true, status: true },
  });
  if (!integration || !integration.encryptedTokens) {
    throw new Error('Integration not found or has no stored tokens');
  }
  const tokens = JSON.parse(decryptSecret(integration.encryptedTokens)) as StoredTokens;
  const expiresAt = new Date(tokens.expiresAt).getTime();
  if (expiresAt - Date.now() > REFRESH_LEAD_MS) {
    return tokens.accessToken;
  }
  const env = getServerEnv();
  try {
    const fresh = await refreshTokens({
      refreshToken: tokens.refreshToken,
      clientId: env.GRAPH_CLIENT_ID ?? '',
      clientSecret: env.GRAPH_CLIENT_SECRET ?? '',
    });
    const ciphertext = encryptSecret(
      JSON.stringify({
        accessToken: fresh.accessToken,
        refreshToken: fresh.refreshToken,
        expiresAt: fresh.expiresAt.toISOString(),
        grantedScopes: fresh.grantedScopes,
      } satisfies StoredTokens),
    );
    await prisma.integration.update({
      where: { id: integration.id },
      data: {
        encryptedTokens: ciphertext,
        expiresAt: fresh.expiresAt,
        grantedScopes: [...fresh.grantedScopes],
        status: 'active',
        keyVersion: env.ENCRYPTION_KEY_VERSION,
        lastError: null,
      },
    });
    return fresh.accessToken;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Refresh failed';
    await prisma.integration.update({
      where: { id: integration.id },
      data: { status: 'error', lastError: message },
    });
    throw err;
  }
}
