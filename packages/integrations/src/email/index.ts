// Resend transactional email adapter skeleton — implemented in Phase 2.3.
// Responsibilities:
// - Send invitation emails (FR/EN templates)
// - Send password reset emails (delegated to Supabase Auth via custom SMTP)
// - Throttling and retry handled by Inngest job (cf. ADR 0005)
export const EMAIL_INTEGRATION_KEY = 'resend' as const;
