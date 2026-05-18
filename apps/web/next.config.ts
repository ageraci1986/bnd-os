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
  // Force Vercel's file tracer to include Prisma's generated client +
  // query engine binary (`libquery_engine-rhel-openssl-3.0.x.so.node`)
  // in the deployed Lambda. With pnpm the engine lives under
  // `.pnpm/@prisma+client@*/node_modules/.prisma/client/`, which Vercel's
  // auto-tracer misses because the workspace hoist obscures the import
  // path. Without these globs the function boots fine but the first
  // Prisma call dies at runtime with a generic "query engine" error.
  outputFileTracingIncludes: {
    '/**/*': [
      '../../node_modules/.pnpm/@prisma+client@*/node_modules/.prisma/client/**',
      '../../node_modules/.pnpm/@prisma+engines@*/node_modules/@prisma/engines/**',
      '../../packages/db/prisma/schema.prisma',
    ],
  },
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
