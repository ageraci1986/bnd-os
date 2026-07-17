import type { ImapFlow } from 'imapflow';

export interface ParsedImapAttachment {
  readonly partNumber: string;
  readonly filename: string;
  readonly contentType: string;
  readonly sizeBytes: number;
  readonly contentId: string | null;
  readonly isInline: boolean;
}

interface BodyStructureNode {
  /**
   * ImapFlow's real BODYSTRUCTURE output collapses type+subtype into a single
   * lowercased string (e.g. "application/pdf", "multipart/mixed"). Test
   * fixtures / older shapes may instead provide `type` + `subtype` as
   * separate fields — both are supported below.
   */
  readonly type?: string;
  readonly subtype?: string;
  readonly part?: string;
  readonly disposition?: string;
  readonly dispositionParameters?: { readonly filename?: string };
  readonly parameters?: { readonly name?: string };
  readonly id?: string;
  readonly size?: number;
  readonly childNodes?: readonly BodyStructureNode[];
}

/**
 * Splits the node's `type` field into main-type + subtype, tolerating both
 * the real ImapFlow shape (`type: "application/pdf"`, no `subtype`) and a
 * separate-fields shape (`type: "application", subtype: "pdf"`).
 */
function typeParts(node: BodyStructureNode): { readonly main: string; readonly sub: string } {
  const raw = (node.type ?? '').toLowerCase();
  if (raw.includes('/')) {
    const [main, sub] = raw.split('/');
    return { main: main || 'application', sub: sub || 'octet-stream' };
  }
  return { main: raw || 'application', sub: (node.subtype ?? 'octet-stream').toLowerCase() };
}

function isAttachmentNode(node: BodyStructureNode, mainType: string): boolean {
  const disp = (node.disposition ?? '').toLowerCase();
  if (disp === 'attachment') return true;
  // Inline image with a Content-ID (used by cid: HTML img references) also counts.
  if (disp === 'inline' && mainType === 'image' && Boolean(node.id)) return true;
  return false;
}

function fileNameOf(node: BodyStructureNode): string {
  return node.dispositionParameters?.filename ?? node.parameters?.name ?? 'attachment.bin';
}

/**
 * Walk the ImapFlow BODYSTRUCTURE tree and return every part that qualifies
 * as an attachment. Inline images (cid: referenced from the HTML body) are
 * included with `isInline=true` so consumers can distinguish them from real
 * attachments when needed.
 */
export function parseImapAttachments(bodyStructure: unknown): readonly ParsedImapAttachment[] {
  const out: ParsedImapAttachment[] = [];

  function walk(node: BodyStructureNode): void {
    if (node.childNodes && node.childNodes.length > 0) {
      for (const child of node.childNodes) walk(child);
      return;
    }
    const { main, sub } = typeParts(node);
    if (!isAttachmentNode(node, main)) return;
    const isInline = (node.disposition ?? '').toLowerCase() === 'inline';
    out.push({
      partNumber: node.part ?? '',
      filename: fileNameOf(node),
      contentType: `${main}/${sub}`,
      sizeBytes: node.size ?? 0,
      contentId: node.id ?? null,
      isInline,
    });
  }

  walk(bodyStructure as BodyStructureNode);
  return out;
}

/**
 * Fetch a single attachment's raw binary via `session.download` on the
 * specified part number. Caller owns the ImapFlow session lifecycle
 * (open/mailboxOpen/logout) — this function does not log out. Returns null
 * when the server has no data for that part.
 */
export async function fetchImapAttachmentBinary(
  session: ImapFlow,
  uid: number,
  partNumber: string,
): Promise<Buffer | null> {
  const dl = await session.download(String(uid), partNumber, { uid: true });
  if (!dl?.content) return null;
  const chunks: Buffer[] = [];
  for await (const chunk of dl.content) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string));
  }
  return Buffer.concat(chunks);
}
