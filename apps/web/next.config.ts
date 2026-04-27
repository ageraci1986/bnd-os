import type { NextConfig } from 'next';
import path from 'node:path';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Moved out of `experimental` in Next 15.5+
  typedRoutes: true,
  // Trace files up to the monorepo root so Next can resolve workspace
  // packages (notably `@prisma/client`) hoisted at the root.
  outputFileTracingRoot: path.join(__dirname, '../..'),
  // Keep Prisma external (it ships precompiled binaries that must not be bundled).
  serverExternalPackages: ['@prisma/client', '@nexushub/db'],
  // SECURITY: explicit transpilation for workspace packages
  transpilePackages: ['@nexushub/ui', '@nexushub/domain', '@nexushub/integrations'],
  // Headers handled in middleware.ts (CSP nonce per request).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
  images: {
    formats: ['image/avif', 'image/webp'],
    remotePatterns: [
      // Supabase Storage (avatars + V1.5 attachments)
      { protocol: 'https', hostname: '*.supabase.co' },
    ],
  },
};

export default nextConfig;
