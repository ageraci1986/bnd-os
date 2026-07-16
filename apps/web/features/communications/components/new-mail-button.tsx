'use client';
import { useComposePanelStore } from '@/stores/compose-panel-store';

export function NewMailButton() {
  return (
    <button
      type="button"
      onClick={() => useComposePanelStore.getState().open({ mode: 'new_mail' })}
      className="btn btn-primary btn-sm"
    >
      + Nouveau mail
    </button>
  );
}
