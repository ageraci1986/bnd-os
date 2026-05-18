export const SCOPE_ERROR_MESSAGE = "Cette ressource n'est pas accessible avec ton scope actuel.";

/**
 * Shared error message returned by every write-path Server Action when the
 * caller is a Viewer. Viewers are read-only: they may open cards and (in a
 * future iteration) post comments, but cannot mutate cards or projects.
 */
export const VIEWER_READ_ONLY_MESSAGE = 'Action indisponible : rôle Viewer en lecture seule.';
