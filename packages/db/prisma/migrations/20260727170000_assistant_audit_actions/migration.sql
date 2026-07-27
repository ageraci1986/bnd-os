-- Assistant (agent conversationnel) : traçage des tours, du gate et des tools.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'assistant_turn';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'assistant_gate';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'assistant_tool_run';
