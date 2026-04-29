'use client';
import { useActionState, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  BUILTIN_PROJECT_TYPES,
  BUILTIN_TEMPLATES,
  findTemplate,
  validateProjectName,
} from '@nexushub/domain';
import { CSRF_FIELD_NAME } from '@/lib/csrf/field';
import { createProject, type CreateProjectState } from '../actions/create-project';

const INITIAL: CreateProjectState = { status: 'idle' };

const STEPS = [
  { idx: '01', name: 'Informations' },
  { idx: '02', name: 'Type de projet' },
  { idx: '03', name: 'Template Kanban' },
  { idx: '04', name: 'Récap' },
] as const;

export interface WizardProps {
  readonly csrfToken: string;
  readonly clients: readonly { readonly id: string; readonly name: string }[];
}

interface WizardState {
  name: string;
  clientId: string;
  description: string;
  startDate: string;
  endDate: string;
  typeId: string;
  templateId: string;
}

const EMPTY: WizardState = {
  name: '',
  clientId: '',
  description: '',
  startDate: '',
  endDate: '',
  typeId: '',
  templateId: 'creative',
};

export function ProjectWizard({ csrfToken, clients }: WizardProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [data, setData] = useState<WizardState>(EMPTY);
  const [actionState, action, pending] = useActionState(createProject, INITIAL);

  // Server Action redirects on success — we only ever land here on errors.
  useEffect(() => {
    if (actionState.status === 'error') {
      // Bring the user back to the recap step so they see the error inline.
      setStep(3);
    }
  }, [actionState.status]);

  const canNext = useMemo(() => {
    if (step === 0) {
      const nameOk = validateProjectName(data.name).ok;
      return nameOk && data.clientId.length > 0;
    }
    if (step === 1) return true; // type optional
    if (step === 2) return data.templateId.length > 0;
    return true;
  }, [step, data]);

  return (
    <form action={action} className="wizard" noValidate>
      <input type="hidden" name={CSRF_FIELD_NAME} value={csrfToken} />
      <input type="hidden" name="name" value={data.name} />
      <input type="hidden" name="clientId" value={data.clientId} />
      <input type="hidden" name="description" value={data.description} />
      <input type="hidden" name="startDate" value={data.startDate} />
      <input type="hidden" name="endDate" value={data.endDate} />
      <input type="hidden" name="typeId" value={data.typeId} />
      <input type="hidden" name="templateId" value={data.templateId} />

      <div className="wiz-head">
        <div>
          <div className="wiz-kicker">✦ Assistant de création · étape {step + 1} / 4</div>
          <h1 className="wiz-title">{stepTitle(step)}</h1>
        </div>
        <Link href="/projects" aria-label="Annuler" className="btn btn-ghost btn-icon">
          ✕
        </Link>
      </div>

      <div className="stepper" role="tablist">
        {STEPS.map((s, i) => {
          const cls = i === step ? 'active' : i < step ? 'done' : 'pending';
          return (
            <div key={s.idx} className={`step ${cls}`}>
              <div className="step-idx">N° {s.idx}</div>
              <div className="step-name">{s.name}</div>
            </div>
          );
        })}
      </div>

      <div className="wiz-body">
        {step === 0 ? <Step1 data={data} setData={setData} clients={clients} /> : null}
        {step === 1 ? <Step2 data={data} setData={setData} /> : null}
        {step === 2 ? <Step3 data={data} setData={setData} /> : null}
        {step === 3 ? <Step4 data={data} clients={clients} error={actionState} /> : null}
      </div>

      <div className="wiz-foot">
        <div className="wiz-foot-info">
          {step === 0 && 'Renseignez le nom + le client pour continuer'}
          {step === 1 && 'Choisissez un type ou passez'}
          {step === 2 && 'Choisissez un template, "Vide" pour démarrer libre'}
          {step === 3 && 'Vérifiez et créez le projet'}
        </div>
        <div className="flex gap-2">
          {step > 0 ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setStep((s) => Math.max(0, s - 1))}
              disabled={pending}
            >
              ← Retour
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => router.push('/projects')}
              disabled={pending}
            >
              Annuler
            </button>
          )}
          {step < 3 ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => setStep((s) => Math.min(3, s + 1))}
              disabled={!canNext}
            >
              Suivant →
            </button>
          ) : (
            <button
              type="submit"
              className="btn btn-primary"
              disabled={pending || !canNext}
              aria-busy={pending || undefined}
            >
              {pending ? 'Création…' : 'Créer le projet →'}
            </button>
          )}
        </div>
      </div>
    </form>
  );
}

function stepTitle(step: number): React.ReactNode {
  switch (step) {
    case 0:
      return (
        <>
          Informations <span className="gradient-text">générales</span>
        </>
      );
    case 1:
      return (
        <>
          Type de <span className="gradient-text">projet</span>
        </>
      );
    case 2:
      return (
        <>
          Template <span className="gradient-text">Kanban</span>
        </>
      );
    default:
      return (
        <>
          Récapitulatif <span className="gradient-text">final</span>
        </>
      );
  }
}

// ---------- Steps -----------------------------------------------------------

function Step1({
  data,
  setData,
  clients,
}: {
  data: WizardState;
  setData: React.Dispatch<React.SetStateAction<WizardState>>;
  clients: readonly { readonly id: string; readonly name: string }[];
}) {
  return (
    <div className="grid gap-4">
      <div>
        <label htmlFor="proj-name" className="field-label">
          Nom du projet
        </label>
        <input
          id="proj-name"
          type="text"
          required
          maxLength={160}
          className="field-input"
          placeholder="Campagne Été 2026"
          value={data.name}
          onChange={(e) => setData((d) => ({ ...d, name: e.target.value }))}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="proj-client" className="field-label">
            Client associé
          </label>
          <select
            id="proj-client"
            required
            className="field-select"
            value={data.clientId}
            onChange={(e) => setData((d) => ({ ...d, clientId: e.target.value }))}
          >
            <option value="">— Choisir un client —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="proj-start" className="field-label">
              Début
            </label>
            <input
              id="proj-start"
              type="date"
              className="field-input"
              value={data.startDate}
              onChange={(e) => setData((d) => ({ ...d, startDate: e.target.value }))}
            />
          </div>
          <div>
            <label htmlFor="proj-end" className="field-label">
              Fin estimée
            </label>
            <input
              id="proj-end"
              type="date"
              className="field-input"
              value={data.endDate}
              onChange={(e) => setData((d) => ({ ...d, endDate: e.target.value }))}
            />
          </div>
        </div>
      </div>
      <div>
        <label htmlFor="proj-desc" className="field-label">
          Description (optionnel)
        </label>
        <textarea
          id="proj-desc"
          rows={3}
          maxLength={2000}
          className="field-input"
          placeholder="Brief, contraintes, livrables clés…"
          value={data.description}
          onChange={(e) => setData((d) => ({ ...d, description: e.target.value }))}
        />
      </div>
    </div>
  );
}

function Step2({
  data,
  setData,
}: {
  data: WizardState;
  setData: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  return (
    <div className="pickable-grid">
      {BUILTIN_PROJECT_TYPES.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={data.typeId === t.id}
          className={`pickable-card ${data.typeId === t.id ? 'active' : ''}`}
          onClick={() => setData((d) => ({ ...d, typeId: d.typeId === t.id ? '' : t.id }))}
        >
          <div className="pc-icon">{t.icon}</div>
          <div className="pc-name">{t.name}</div>
          <div className="pc-desc">{t.description}</div>
        </button>
      ))}
    </div>
  );
}

function Step3({
  data,
  setData,
}: {
  data: WizardState;
  setData: React.Dispatch<React.SetStateAction<WizardState>>;
}) {
  return (
    <div className="pickable-grid">
      {BUILTIN_TEMPLATES.map((t) => (
        <button
          key={t.id}
          type="button"
          aria-pressed={data.templateId === t.id}
          className={`pickable-card ${data.templateId === t.id ? 'active' : ''}`}
          onClick={() => setData((d) => ({ ...d, templateId: t.id }))}
        >
          {t.recommended ? <span className="pc-recommended">Recommandé</span> : null}
          <div className="pc-name">{t.name}</div>
          <div className="pc-desc">{t.description}</div>
          <div className="tpl-preview">
            {t.columns.map((c) => (
              <span key={c} className="tpl-pill">
                {c}
              </span>
            ))}
            <span className="tpl-pill blocked">Bloqué</span>
          </div>
        </button>
      ))}
    </div>
  );
}

function Step4({
  data,
  clients,
  error,
}: {
  data: WizardState;
  clients: readonly { readonly id: string; readonly name: string }[];
  error: CreateProjectState;
}) {
  const client = clients.find((c) => c.id === data.clientId);
  const type = BUILTIN_PROJECT_TYPES.find((t) => t.id === data.typeId);
  const template = findTemplate(data.templateId);
  const dateRange =
    data.startDate || data.endDate ? `${data.startDate || '?'} → ${data.endDate || '?'}` : '—';

  return (
    <div className="recap-grid">
      <div className="recap-block">
        <h4>— Récapitulatif</h4>
        <div className="recap-row">
          <span className="label">Nom</span>
          <span className="value">{data.name || '—'}</span>
        </div>
        <div className="recap-row">
          <span className="label">Client</span>
          <span className="value">{client?.name ?? '—'}</span>
        </div>
        <div className="recap-row">
          <span className="label">Dates</span>
          <span className="value">{dateRange}</span>
        </div>
        <div className="recap-row">
          <span className="label">Type</span>
          <span className="value">{type ? `${type.icon} ${type.name}` : '—'}</span>
        </div>
        <div className="recap-row">
          <span className="label">Template</span>
          <span className="value">{template?.name ?? '—'}</span>
        </div>
        <div className="recap-row">
          <span className="label">Colonnes</span>
          <span className="value">{template ? `${template.columns.length} + Bloqué` : '—'}</span>
        </div>
      </div>
      {error.status === 'error' ? (
        <p
          role="alert"
          className="rounded-md border border-[color:var(--color-danger)] bg-[color:var(--color-danger-bg)] px-3 py-2 text-sm font-medium text-[color:var(--color-danger)]"
        >
          {error.message}
        </p>
      ) : null}
    </div>
  );
}
