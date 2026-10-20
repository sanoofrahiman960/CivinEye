import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2, SearchX, WifiOff, X, type LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';

import type { ApiError } from '../api/client';

// --- Buttons -------------------------------------------------------------------

type Variant = 'primary' | 'outline' | 'ghost' | 'danger' | 'success' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'md' | 'sm';
  icon?: LucideIcon;
  loading?: boolean;
}

export function Button({ variant = 'primary', size = 'md', icon: Icon, loading, children, className = '', disabled, type = 'button', ...rest }: ButtonProps) {
  const classes = ['btn', variant !== 'primary' ? `btn-${variant}` : '', size === 'sm' ? 'btn-sm' : '', className].filter(Boolean).join(' ');
  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Loader2 size={16} className="spin" aria-hidden /> : Icon ? <Icon size={16} aria-hidden /> : null}
      {children}
    </button>
  );
}

// --- Form fields -------------------------------------------------------------------

interface FieldProps {
  label: string;
  error?: string;
  hint?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}

export function Field({ label, error, hint, children }: FieldProps) {
  const id = useId();
  const describedBy = error || hint ? `${id}-desc` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id, describedBy)}
      {error ? (
        <span id={describedBy} className="error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span id={describedBy} className="hint">
          {hint}
        </span>
      ) : null}
    </div>
  );
}

export function TextInput({ label, error, hint, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, describedBy) => (
        <input id={id} aria-invalid={!!error} aria-describedby={describedBy} className={`input${error ? ' invalid' : ''}`} {...rest} />
      )}
    </Field>
  );
}

export function TextArea({ label, error, hint, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; error?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, describedBy) => (
        <textarea id={id} aria-invalid={!!error} aria-describedby={describedBy} className={`textarea${error ? ' invalid' : ''}`} {...rest} />
      )}
    </Field>
  );
}

export function Select({ label, error, hint, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { label: string; error?: string; hint?: string }) {
  return (
    <Field label={label} error={error} hint={hint}>
      {(id, describedBy) => (
        <select id={id} aria-invalid={!!error} aria-describedby={describedBy} className="select" {...rest}>
          {children}
        </select>
      )}
    </Field>
  );
}

export interface ChipOption<T extends string | number> {
  value: T;
  label: string;
}

export function ChipGroup<T extends string | number>({ label, options, selected, onToggle }: { label: string; options: ChipOption<T>[]; selected: T[]; onToggle: (value: T) => void }) {
  return (
    <div className="chips" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" className="chip" aria-pressed={selected.includes(option.value)} onClick={() => onToggle(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: ChipOption<T>[]; value: T; onChange: (value: T) => void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

// --- Layout helpers ---------------------------------------------------------------------

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function Card({ title, actions, children, className = '', bodyClassName = 'card-body' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={`card ${className}`}>
      {title || actions ? (
        <header className="card-header">
          {typeof title === 'string' ? <h2>{title}</h2> : title}
          {actions}
        </header>
      ) : null}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

const BANNER_ICONS: Record<'info' | 'success' | 'warning' | 'danger', LucideIcon> = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  danger: AlertCircle,
};

export function Banner({ tone = 'info', title, children }: { tone?: 'info' | 'success' | 'warning' | 'danger'; title?: string; children: ReactNode }) {
  const Icon = BANNER_ICONS[tone];
  return (
    <div className={`banner banner-${tone}`} role={tone === 'danger' || tone === 'warning' ? 'alert' : 'status'}>
      <Icon size={18} aria-hidden style={{ flexShrink: 0, marginTop: 2 }} />
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function KeyValues({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([label, value]) => (
        <div key={label} style={{ display: 'contents' }}>
          <dt>{label}</dt>
          <dd>{value ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

// --- States -----------------------------------------------------------------------------------

export function LoadingState({ message = 'Loading…' }: { message?: string }) {
  return (
    <div className="state" role="status" aria-live="polite">
      <Loader2 size={28} className="spin" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

export function EmptyState({ icon: Icon = SearchX, title, message, action }: { icon?: LucideIcon; title: string; message?: string; action?: ReactNode }) {
  return (
    <div className="state">
      <div className="state-icon">
        <Icon size={28} aria-hidden />
      </div>
      <h2>{title}</h2>
      {message ? <p style={{ margin: 0 }}>{message}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: ApiError | null; onRetry?: () => void }) {
  const offline = error?.isNetworkError;
  return (
    <div className="state" role="alert">
      <div className="state-icon" style={{ background: 'var(--c-danger-50)', color: 'var(--c-danger)' }}>
        {offline ? <WifiOff size={28} aria-hidden /> : <AlertCircle size={28} aria-hidden />}
      </div>
      <h2>{offline ? 'Server unreachable' : 'Something went wrong'}</h2>
      <p style={{ margin: 0 }}>{error?.message ?? 'Please try again.'}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}

// --- Modal --------------------------------------------------------------------------------------

interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

/** Accessible dialog: focus moves inside, Escape closes, the page behind is inert to clicks. */
export function Modal({ open, title, onClose, children, footer, wide }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = dialogRef.current?.querySelector<HTMLElement>('input, textarea, select, button:not([data-close])');
    (first ?? dialogRef.current)?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div ref={dialogRef} className="modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} style={wide ? { maxWidth: 760 } : undefined}>
        <div className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <Button variant="icon" aria-label="Close dialog" data-close onClick={onClose} icon={X} />
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

interface ReasonDialogProps {
  open: boolean;
  title: string;
  message?: ReactNode;
  label?: string;
  placeholder?: string;
  confirmLabel: string;
  required?: boolean;
  danger?: boolean;
  busy?: boolean;
  error?: string | null;
  onCancel: () => void;
  onConfirm: (text: string) => void;
  children?: ReactNode;
}

/** Confirmation dialog that collects a reason (or an optional comment). */
export function ReasonDialog(props: ReasonDialogProps) {
  // Mounting the body only while open gives every opening a fresh, empty form.
  return props.open ? <ReasonDialogBody {...props} /> : null;
}

function ReasonDialogBody({ title, message, label = 'Reason', placeholder, confirmLabel, required = true, danger, busy, error, onCancel, onConfirm, children }: ReasonDialogProps) {
  const [text, setText] = useState('');
  const [localError, setLocalError] = useState<string | undefined>();

  function submit() {
    if (required && text.trim().length < 3) {
      setLocalError('Please give a short reason (at least 3 characters).');
      return;
    }
    onConfirm(text.trim());
  }

  return (
    <Modal
      open
      title={title}
      onClose={() => !busy && onCancel()}
      footer={
        <>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={submit} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {message ? <div style={{ marginBottom: 12 }} className="muted">{message}</div> : null}
      <TextArea
        label={required ? label : `${label} (optional)`}
        value={text}
        placeholder={placeholder}
        maxLength={2000}
        onChange={(event) => {
          setText(event.target.value);
          setLocalError(undefined);
        }}
        error={localError ?? error ?? undefined}
      />
      {children}
    </Modal>
  );
}
