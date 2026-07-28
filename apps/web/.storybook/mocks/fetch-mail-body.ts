/**
 * Storybook-only stand-in for `@/features/communications/actions/fetch-mail-body`
 * (Plan 4 Task 6). `@storybook/nextjs-vite` already neutralizes the
 * `server-only` marker package itself (its bundled `alias/rsc/server-only`
 * stub resolves to `{}`), so that import alone isn't the problem — the real
 * one is everything else the real module pulls in: `@nexushub/db` (Prisma)
 * and the IMAP adapter, neither of which can run in a browser bundle.
 * Verified: without mocking this out, Prisma's generated client tries to
 * load its `.prisma/client/index-browser` entry and the browser's ES module
 * loader rejects the bare specifier, crashing the story before React even
 * renders — regardless of whether the action is ever actually invoked
 * (widgets that statically import it, e.g. `MailListWidget`, pull the whole
 * module graph in at parse time). Wired in via a custom `resolveId` plugin
 * in `.storybook/main.ts` (matches by resolved file path, not import
 * specifier text — see that file's comment), per Storybook's own guidance
 * for RSC/Server Action data-access layers ("React Server Components >
 * Mocking Server Resources").
 *
 * Never wired into any production import — Next's real bundler (not Vite)
 * builds the actual app, so this file has no effect outside Storybook.
 */

export type FetchMailBodyResult =
  | { readonly ok: true; readonly bodyText: string; readonly bodyHtmlSanitized: string | null }
  | { readonly ok: false; readonly message: string };

export async function fetchMailBody(
  _input: Readonly<{ emailId: string }>,
): Promise<FetchMailBodyResult> {
  return {
    ok: false,
    message: 'Storybook : contenu du mail non disponible (Server Action non mockée ici).',
  };
}
