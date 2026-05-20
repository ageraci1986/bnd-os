/**
 * DTO shared between server (load-card-comments, get-card-modal-data) and
 * client (card-comments-thread). The `bodyHtml` field is rendered server-
 * side via `@nexushub/integrations/markdown` so the client only needs to
 * dump it into `dangerouslySetInnerHTML` — already sanitised.
 */
export interface CardCommentDTO {
  readonly id: string;
  readonly body: string;
  readonly bodyHtml: string;
  readonly createdAt: string; // ISO
  readonly updatedAt: string; // ISO
  readonly isEdited: boolean;
  readonly author: {
    readonly id: string;
    readonly displayName: string;
    readonly initials: string;
  };
  /** True when the current viewer authored this comment (can edit/delete). */
  readonly isMine: boolean;
  /** True when the current viewer is Admin (can delete any comment). */
  readonly canModerate: boolean;
}
