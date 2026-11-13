import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { readThemeCookie } from '@/lib/theme/cookie';
import '../styles/globals.css';

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  variable: '--font-sans',
  display: 'swap',
});
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-mono',
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'BND OS', template: '%s · BND OS' },
  description: 'Agency OS — Client › Project › Task',
  applicationName: 'BND OS',
  // SEO neutralisé : app privée
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#EEF0F8' }, // theme-exempt: meta theme-color
    { media: '(prefers-color-scheme: dark)', color: '#060D1F' }, // theme-exempt: meta theme-color
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const theme = await readThemeCookie();
  return (
    <html
      lang="fr"
      className={`${inter.variable} ${jetbrainsMono.variable}`}
      data-theme={theme}
      suppressHydrationWarning
    >
      <body>{children}</body>
    </html>
  );
}
