export function IntegrationsGrid() {
  return (
    <div className="grid gap-4">
      <article className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 text-xs text-[color:var(--color-text-muted)]">
        💬 Slack — bientôt (workspace-level, mapping canal ↔ client)
      </article>
      <article className="rounded-2xl border border-dashed border-[color:var(--color-border-light)] bg-[color:var(--color-bg-card)] p-5 text-xs text-[color:var(--color-text-muted)]">
        🎤 Fireflies / Otter — bientôt (transcriptions de réunions)
      </article>
    </div>
  );
}
