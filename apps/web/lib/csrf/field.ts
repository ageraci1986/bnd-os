/**
 * CSRF form field name — exported from a separate module so it can be
 * imported from BOTH client and server components. The main `lib/csrf`
 * module is `server-only` (it touches cookies + crypto) and would crash
 * if a 'use client' file imported it, even just for the constant.
 */
export const CSRF_FIELD_NAME = '_csrf';
