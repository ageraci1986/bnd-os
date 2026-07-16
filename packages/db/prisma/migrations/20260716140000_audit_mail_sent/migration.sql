-- New audit kinds for the mail send outbox (Communications iter 3, Task 13).
-- Logs successful and failed outbound sends. Payload is PII-safe:
-- {integrationId, toDomains, subjectLen} / {integrationId, code, toDomains}.

ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'mail_sent';
ALTER TYPE "public"."AuditAction" ADD VALUE IF NOT EXISTS 'mail_send_failed';
