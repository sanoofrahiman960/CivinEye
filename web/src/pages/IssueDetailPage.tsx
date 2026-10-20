import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Camera,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Eye,
  Flag,
  ImageIcon,
  LocateFixed,
  Lock,
  Mail,
  MapPin,
  MessageSquare,
  MinusCircle,
  Navigation,
  Phone,
  Repeat,
  RotateCcw,
  Send,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash2,
  Upload,
  UserCheck,
  Users,
  WifiOff,
  Wrench,
  X,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router';

import { ApiError, toApiError } from '../api/client';
import { authorityApi, type ResolutionCapture } from '../api/endpoints';
import { ImpactBadge, OverdueBadge, PriorityBadge, StatusBadge } from '../components/badges';
import { IssueMap, type MapPoint } from '../components/IssueMap';
import {
  Banner,
  Button,
  Card,
  ChipGroup,
  EmptyState,
  ErrorState,
  KeyValues,
  LoadingState,
  Modal,
  PageHeader,
  ReasonDialog,
  Segmented,
  Select,
  TextArea,
} from '../components/ui';
import { useAction, useApi, useDocumentTitle } from '../hooks/useApi';
import { formatCoordinate, formatDate, formatDateTime, formatDistance, formatDue, formatRelative } from '../lib/format';
import { issuesLink } from '../lib/issueQuery';
import { PRIORITY_ORDER, PRIORITY_STYLES, ROLE_LABELS, STATUS_STYLES } from '../lib/styles';
import { isSupervisorOrAdmin, useAuthStore } from '../store/auth';
import { useReferenceStore } from '../store/reference';
import type {
  AuthorityAction,
  AuthorityHistoryEntry,
  AuthorityIssueDetail,
  AuthorityIssueImage,
  CaptureSource,
  ClosureType,
  Comment,
  CommentVisibility,
  DepartmentMini,
  ImageType,
  Priority,
  ProofCheckStatus,
  User,
} from '../types/api';

// ---------------------------------------------------------------------------------------------
// Display constants
// ---------------------------------------------------------------------------------------------

type ActionKind = Exclude<AuthorityAction, 'comment'>;

const ACTION_ORDER: ActionKind[] = ['acknowledge', 'start_work', 'resolve', 'assign', 'change_priority', 'reopen', 'close'];

const ACTION_META: Record<ActionKind, { label: string; icon: LucideIcon; variant: 'primary' | 'outline' | 'danger' | 'success' }> = {
  acknowledge: { label: 'Acknowledge', icon: Eye, variant: 'primary' },
  start_work: { label: 'Start work', icon: Wrench, variant: 'primary' },
  resolve: { label: 'Submit resolution', icon: CheckCircle2, variant: 'success' },
  assign: { label: 'Assign', icon: Users, variant: 'outline' },
  change_priority: { label: 'Change priority', icon: Flag, variant: 'outline' },
  reopen: { label: 'Reopen', icon: RotateCcw, variant: 'outline' },
  close: { label: 'Close issue', icon: XCircle, variant: 'danger' },
};

const IMAGE_TYPE_ORDER: ImageType[] = ['REPORT', 'ADDITIONAL_EVIDENCE', 'RESOLUTION', 'REOPEN_EVIDENCE', 'DURABILITY_EVIDENCE'];

const IMAGE_TYPE_LABELS: Record<ImageType, string> = {
  REPORT: 'Reported',
  ADDITIONAL_EVIDENCE: 'Extra evidence',
  RESOLUTION: 'Resolution',
  REOPEN_EVIDENCE: 'Reopen evidence',
  DURABILITY_EVIDENCE: 'Follow-up',
};

const PROOF_STYLES: Record<ProofCheckStatus, { label: string; badge: string; icon: LucideIcon; text: string }> = {
  PASSED: {
    label: 'Passed',
    badge: 'badge-success',
    icon: ShieldCheck,
    text: 'Taken at the issue location and not a re-used photo.',
  },
  FLAGGED: {
    label: 'Flagged',
    badge: 'badge-danger',
    icon: ShieldAlert,
    text: 'Did not pass the location/originality check. A supervisor must review it before it counts as evidence.',
  },
  OVERRIDDEN: {
    label: 'Overridden',
    badge: 'badge-warning',
    icon: UserCheck,
    text: 'Flagged by Proof-Lock, then reviewed and accepted by a supervisor.',
  },
  NOT_APPLICABLE: {
    label: 'Not applicable',
    badge: 'badge-neutral',
    icon: MinusCircle,
    text: 'Proof-Lock was not active when this photo was submitted.',
  },
};

/** Statuses the backend accepts as valid resolution evidence (services.ACCEPTED_PROOF). */
const ACCEPTED_PROOF: ProofCheckStatus[] = ['PASSED', 'OVERRIDDEN', 'NOT_APPLICABLE'];

const CAPTURE_SOURCE_LABELS: Record<CaptureSource, string> = {
  CAMERA: 'In-app camera',
  GALLERY: 'Gallery / dashboard upload',
  UNKNOWN: 'Unknown',
};

const CLOSURE_TEXT: Record<Exclude<ClosureType, ''>, string> = {
  CITIZEN_CONFIRMED: 'Closed — the reporter confirmed the fix.',
  AUTO_TIMEOUT: 'Closed automatically — not confirmed by the reporter within the verification window.',
  ADMIN_CLOSED: 'Closed directly by an administrator, without citizen verification.',
};

const ACCEPTED_FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_RESOLUTION_FILES = 5;

const LIST_RESET = { listStyle: 'none', margin: 0, padding: 0 } as const;

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

type NoticeTone = 'success' | 'info' | 'warning' | 'danger';
interface Notice {
  tone: NoticeTone;
  title?: string;
  message: string;
}

/** Errors meaning the issue changed underneath us: refresh and explain rather than keep the dialog open. */
function isStaleError(error: ApiError) {
  return error.code === 'invalid_transition' || error.code === 'issue_closed' || error.status === 404;
}

function byDate<T>(pick: (item: T) => string, direction: 'asc' | 'desc' = 'asc') {
  return (a: T, b: T) => {
    const diff = new Date(pick(a)).getTime() - new Date(pick(b)).getTime();
    return direction === 'asc' ? diff : -diff;
  };
}

function isAcceptedResolution(image: AuthorityIssueImage, cycle: number) {
  return image.image_type === 'RESOLUTION' && image.resolution_cycle === cycle && ACCEPTED_PROOF.includes(image.proof_check_status);
}

/** Great-circle distance in metres, used only as a hint before submitting a resolution. */
function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(a)));
}

function roundTo(value: number, decimals: number) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function actorLabel(entry: AuthorityHistoryEntry) {
  return entry.changed_by ? `${entry.changed_by.full_name} (${ROLE_LABELS[entry.changed_by.role]})` : 'System';
}

/** Validate the `details.images` payload of a `proof_check_flagged` error. */
function flaggedImagesFrom(details: Record<string, unknown>): AuthorityIssueImage[] {
  const images = details.images;
  if (!Array.isArray(images)) return [];
  return images.filter(
    (item): item is AuthorityIssueImage =>
      typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'number' && typeof (item as { proof_check_status?: unknown }).proof_check_status === 'string',
  );
}

function geolocationErrorMessage(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) return 'Location permission was denied. Allow location access for this site in your browser settings to attach it.';
  if (error.code === error.TIMEOUT) return 'Getting your location took too long. Move to an open area and try again.';
  return 'Your location is not available right now.';
}

// ---------------------------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------------------------

export function IssueDetailPage() {
  const { id } = useParams();
  // Keyed by id so dialogs, notices and form state reset when navigating between issues.
  return <IssueDetail key={id ?? ''} idParam={id ?? ''} />;
}

function IssueDetail({ idParam }: { idParam: string }) {
  const issueId = Number(idParam);
  const validId = Number.isInteger(issueId) && issueId > 0;
  const navigate = useNavigate();
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const canOverride = isSupervisorOrAdmin(user);

  const { data: issue, error, loading, reload, refresh, setData } = useApi<AuthorityIssueDetail>(
    () => (validId ? authorityApi.detail(issueId) : Promise.reject(new ApiError(404, 'not_found', 'Issue not found.'))),
    [issueId, validId],
  );
  const { busy, run } = useAction();

  const [dialog, setDialog] = useState<ActionKind | null>(null);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [overrideTarget, setOverrideTarget] = useState<AuthorityIssueImage | null>(null);
  const [overrideError, setOverrideError] = useState<string | null>(null);
  const [transferNotice, setTransferNotice] = useState<string | null>(null);

  useDocumentTitle(issue?.complaint_id ?? 'Issue');

  // After a transfer out of the user's scope, show the notice briefly and return to the list.
  useEffect(() => {
    if (!transferNotice) return;
    const timer = window.setTimeout(() => navigate('/issues', { replace: true, state: { notice: transferNotice } }), 4000);
    return () => window.clearTimeout(timer);
  }, [transferNotice, navigate]);

  const canGoBack = location.key !== 'default';
  const backLink = (
    <Link
      to="/issues"
      className="row"
      style={{ display: 'inline-flex', gap: 6, marginBottom: 12, fontWeight: 600 }}
      onClick={(event) => {
        if (canGoBack) {
          event.preventDefault();
          navigate(-1);
        }
      }}
    >
      <ArrowLeft size={16} aria-hidden />
      Back to issues
    </Link>
  );

  if (transferNotice) {
    return (
      <div>
        {backLink}
        <Banner tone="success" title="Issue transferred">
          <p>{transferNotice}</p>
          <p>Returning you to the issue list…</p>
        </Banner>
        <Button variant="outline" icon={ArrowLeft} onClick={() => navigate('/issues', { replace: true, state: { notice: transferNotice } })}>
          Go to issues now
        </Button>
      </div>
    );
  }

  if (error?.status === 404 || (!validId && !loading)) {
    return (
      <EmptyState
        icon={MapPin}
        title="Issue not found"
        message="Issue not found or no longer in your scope. It may have been transferred to another department."
        action={<Link to="/issues">Back to issues</Link>}
      />
    );
  }

  if (!issue) {
    if (loading) return <LoadingState message="Loading issue…" />;
    return (
      <div>
        {backLink}
        <ErrorState error={error} onRetry={reload} />
      </div>
    );
  }

  const current = issue;
  const actions = ACTION_ORDER.filter((action) => current.available_actions.includes(action));

  function openDialog(kind: ActionKind) {
    setDialogError(null);
    setDialog(kind);
  }

  function closeDialog() {
    setDialog(null);
    setDialogError(null);
  }

  function applyResult(result: AuthorityIssueDetail, message: string) {
    setData(result);
    setDialog(null);
    setDialogError(null);
    setNotice({ tone: 'success', message });
  }

  function handleStale(apiError: ApiError) {
    setDialog(null);
    setDialogError(null);
    setNotice({ tone: 'warning', title: 'This issue has changed', message: `${apiError.message} The page has been refreshed.` });
    refresh();
  }

  async function runDetailAction(action: () => Promise<AuthorityIssueDetail>, success: string, field: string) {
    setDialogError(null);
    try {
      const result = await run(action);
      if (result) applyResult(result, success);
    } catch (err) {
      const apiError = toApiError(err);
      if (isStaleError(apiError)) handleStale(apiError);
      else setDialogError(apiError.fieldError(field) ?? apiError.message);
    }
  }

  function handleAssigned(result: AuthorityIssueDetail) {
    const departmentName = result.department?.name ?? 'another department';
    const keepsAccess =
      user?.role === 'ADMIN' ||
      (result.department !== null && result.department.id === user?.department?.id) ||
      (result.assigned_officer !== null && result.assigned_officer.id === user?.id);
    if (!keepsAccess) {
      setDialog(null);
      setTransferNotice(`Transferred to ${departmentName} — you no longer have access to ${result.complaint_id}.`);
      return;
    }
    const target = result.assigned_officer ? `${result.assigned_officer.full_name} (${departmentName})` : departmentName;
    applyResult(result, `Assigned to ${target}.`);
  }

  async function confirmOverride(reason: string) {
    const target = overrideTarget;
    if (!target) return;
    setOverrideError(null);
    try {
      const updated = await run(() => authorityApi.overrideProofCheck(target.id, reason));
      if (!updated) return;
      setData((prev) => (prev ? { ...prev, images: prev.images.map((image) => (image.id === updated.id ? updated : image)) } : prev));
      setOverrideTarget(null);
      setNotice({ tone: 'success', message: 'Proof-check flag overridden. The photo now counts as resolution evidence.' });
      refresh();
    } catch (err) {
      const apiError = toApiError(err);
      if (apiError.code === 'not_flagged') {
        setOverrideTarget(null);
        setNotice({ tone: 'info', message: 'This photo is no longer flagged — it may already have been reviewed.' });
        refresh();
      } else {
        setOverrideError(apiError.fieldError('reason') ?? apiError.message);
      }
    }
  }

  function handleCommentPosted(comment: Comment) {
    setData((prev) => (prev ? { ...prev, comments: [...prev.comments.filter((c) => c.id !== comment.id), comment] } : prev));
    setNotice({
      tone: 'success',
      message: comment.visibility === 'INTERNAL' ? 'Internal comment posted.' : 'Comment posted. The reporter can now see it.',
    });
    refresh();
  }

  return (
    <div>
      {backLink}
      <PageHeader
        title={
          <>
            <span className="mono">{current.complaint_id}</span>
            <span aria-hidden> · </span>
            <span className="sr-only">: </span>
            {current.title}
          </>
        }
        subtitle={
          <span className="row" style={{ marginTop: 4 }}>
            <StatusBadge status={current.status} long />
            <PriorityBadge priority={current.priority} />
            {current.is_overdue ? <OverdueBadge /> : null}
            <ImpactBadge count={current.impact_count} />
            <span className="subtle">
              {current.category.name} · Reported {formatRelative(current.created_at)}
            </span>
          </span>
        }
        actions={
          actions.length
            ? actions.map((action) => {
                const meta = ACTION_META[action];
                return (
                  <Button key={action} variant={meta.variant} icon={meta.icon} onClick={() => openDialog(action)} disabled={busy}>
                    {meta.label}
                  </Button>
                );
              })
            : null
        }
      />

      {notice ? <DismissibleBanner notice={notice} onDismiss={() => setNotice(null)} /> : null}
      {error && error.status !== 404 ? (
        <Banner tone="warning" title="Couldn't refresh this issue">
          {error.message} The details shown may be out of date.{' '}
          <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>
            Retry
          </button>
        </Banner>
      ) : null}

      <div className="grid grid-detail">
        <div className="stack">
          <PhotosCard issue={current} canOverride={canOverride} onOverride={(image) => { setOverrideError(null); setOverrideTarget(image); }} />
          <BeforeAfterCard issue={current} />
          <DescriptionCard issue={current} />
          <HistoryCard history={current.history} />
          <CommentsCard issue={current} canComment={current.available_actions.includes('comment')} onPosted={handleCommentPosted} />
        </div>
        <div className="stack">
          <LocationCard issue={current} />
          <ReporterCard issue={current} />
          <SlaCard issue={current} />
          <PriorityChangesCard issue={current} />
          <AssignmentsCard issue={current} />
        </div>
      </div>

      {/* --- Status actions ------------------------------------------------------------------ */}
      <ReasonDialog
        open={dialog === 'acknowledge'}
        title="Acknowledge issue"
        message="The reporter is told that the complaint has been received and is being reviewed."
        label="Comment"
        placeholder="e.g. Inspection team scheduled for tomorrow morning."
        confirmLabel="Acknowledge"
        required={false}
        busy={busy}
        error={dialogError}
        onCancel={closeDialog}
        onConfirm={(text) => runDetailAction(() => authorityApi.acknowledge(current.id, text), 'Issue acknowledged.', 'comment')}
      />
      <ReasonDialog
        open={dialog === 'start_work'}
        title="Start work"
        message="Marks the issue as In Progress and notifies the reporter that work has started."
        label="Comment"
        placeholder="e.g. Crew dispatched with replacement parts."
        confirmLabel="Mark as in progress"
        required={false}
        busy={busy}
        error={dialogError}
        onCancel={closeDialog}
        onConfirm={(text) => runDetailAction(() => authorityApi.startWork(current.id, text), 'Work started — the issue is now In Progress.', 'comment')}
      />
      <ReasonDialog
        open={dialog === 'reopen'}
        title="Reopen issue"
        message="Reopening sends the issue back for follow-up work and restarts the resolution cycle. The reporter is notified."
        label="Reason"
        placeholder="Explain what follow-up work is needed."
        confirmLabel="Reopen issue"
        danger
        busy={busy}
        error={dialogError}
        onCancel={closeDialog}
        onConfirm={(text) => runDetailAction(() => authorityApi.reopen(current.id, text), 'Issue reopened.', 'reason')}
      />
      <ReasonDialog
        open={dialog === 'close'}
        title="Close issue"
        message="Closing directly skips citizen verification and is recorded as closed by an administrator. The reporter is notified."
        label="Reason"
        placeholder="Why is this issue being closed without verification?"
        confirmLabel="Close issue"
        danger
        busy={busy}
        error={dialogError}
        onCancel={closeDialog}
        onConfirm={(text) => runDetailAction(() => authorityApi.close(current.id, text), 'Issue closed.', 'reason')}
      />

      {dialog === 'change_priority' ? (
        <PriorityModal issue={current} onClose={closeDialog} onSuccess={applyResult} onStale={handleStale} />
      ) : null}
      {dialog === 'assign' ? (
        <AssignModal issue={current} user={user} onClose={closeDialog} onAssigned={handleAssigned} onStale={handleStale} />
      ) : null}
      {dialog === 'resolve' ? (
        <ResolveModal
          issue={current}
          canOverride={canOverride}
          onClose={closeDialog}
          onResolved={(result) => applyResult(result, 'Resolution submitted. The reporter has been asked to verify the fix.')}
          onStale={handleStale}
          onRefresh={refresh}
        />
      ) : null}

      {/* --- Proof-check override from the photos card ------------------------------------------- */}
      <ReasonDialog
        open={overrideTarget !== null}
        title="Review & override proof check"
        message={
          overrideTarget ? (
            <div className="stack" style={{ gap: 8 }}>
              <span>
                Accepting this flagged photo lets it count as resolution evidence. Your name and reason are recorded in the audit log.
              </span>
              {overrideTarget.proof_check_notes ? (
                <span>
                  <strong>Check notes:</strong> {overrideTarget.proof_check_notes}
                </span>
              ) : null}
              <span>
                <strong>Distance from issue:</strong>{' '}
                {overrideTarget.distance_from_issue_m !== null ? formatDistance(overrideTarget.distance_from_issue_m) : 'No GPS position recorded'}
              </span>
            </div>
          ) : null
        }
        label="Reason for accepting"
        placeholder="e.g. Verified on a site visit; GPS drift near the flyover."
        confirmLabel="Override flag"
        busy={busy}
        error={overrideError}
        onCancel={() => setOverrideTarget(null)}
        onConfirm={confirmOverride}
      >
        {overrideTarget ? (
          <img
            src={overrideTarget.thumbnail_url || overrideTarget.image_url}
            alt="Flagged resolution photo under review"
            style={{ width: '100%', maxHeight: 240, objectFit: 'cover', borderRadius: 'var(--radius)' }}
          />
        ) : null}
      </ReasonDialog>
    </div>
  );
}

function DismissibleBanner({ notice, onDismiss }: { notice: Notice; onDismiss: () => void }) {
  return (
    <div style={{ position: 'relative' }}>
      <Banner tone={notice.tone} title={notice.title}>
        <span style={{ display: 'block', paddingRight: 36 }}>{notice.message}</span>
      </Banner>
      <Button
        variant="icon"
        size="sm"
        icon={X}
        aria-label="Dismiss message"
        onClick={onDismiss}
        style={{ position: 'absolute', top: 4, right: 4, minWidth: 34 }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Photos
// ---------------------------------------------------------------------------------------------

function PhotosCard({ issue, canOverride, onOverride }: { issue: AuthorityIssueDetail; canOverride: boolean; onOverride: (image: AuthorityIssueImage) => void }) {
  const groups = useMemo(
    () =>
      IMAGE_TYPE_ORDER.map((type) => ({
        type,
        images: issue.images.filter((image) => image.image_type === type).sort(byDate((image) => image.uploaded_at)),
      })).filter((group) => group.images.length > 0),
    [issue.images],
  );
  const ordered = useMemo(() => groups.flatMap((group) => group.images), [groups]);
  const [openId, setOpenId] = useState<number | null>(null);
  const openIndex = openId === null ? -1 : ordered.findIndex((image) => image.id === openId);

  return (
    <Card title={`Photos (${issue.images.length})`}>
      {groups.length === 0 ? (
        <p className="muted row" style={{ margin: 0, gap: 6 }}>
          <ImageIcon size={16} aria-hidden />
          No photos have been uploaded for this issue.
        </p>
      ) : (
        <div className="stack">
          {groups.map((group) => (
            <section key={group.type} aria-labelledby={`photos-${group.type}`}>
              <h3 id={`photos-${group.type}`} style={{ marginBottom: 8 }}>
                {IMAGE_TYPE_LABELS[group.type]} <span className="subtle">({group.images.length})</span>
              </h3>
              {group.type === 'RESOLUTION' ? (
                <ul className="stack" style={LIST_RESET}>
                  {[...group.images].sort((a, b) => b.resolution_cycle - a.resolution_cycle || new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()).map((image) => (
                    <li key={image.id} className="row" style={{ alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
                      <PhotoThumb image={image} onOpen={() => setOpenId(image.id)} />
                      <ProofCheckInfo
                        image={image}
                        currentCycle={issue.resolution_cycle}
                        canOverride={canOverride}
                        onOverride={() => onOverride(image)}
                      />
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="photos">
                  {group.images.map((image) => (
                    <PhotoThumb key={image.id} image={image} onOpen={() => setOpenId(image.id)} />
                  ))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
      {openIndex >= 0 ? (
        <Lightbox images={ordered} index={openIndex} onClose={() => setOpenId(null)} onNavigate={(index) => setOpenId(ordered[index].id)} />
      ) : null}
    </Card>
  );
}

function PhotoThumb({ image, onOpen }: { image: AuthorityIssueImage; onOpen: () => void }) {
  const label = IMAGE_TYPE_LABELS[image.image_type];
  return (
    <button
      type="button"
      className="photo"
      onClick={onOpen}
      aria-label={`Open ${label.toLowerCase()} photo${image.caption ? `: ${image.caption}` : ''}, uploaded ${formatDateTime(image.uploaded_at)}`}
    >
      <img src={image.thumbnail_url || image.image_url} alt="" loading="lazy" />
      <span className="tag">
        {label} · {formatDate(image.uploaded_at)}
      </span>
    </button>
  );
}

function ProofStatusBadge({ status }: { status: ProofCheckStatus }) {
  const style = PROOF_STYLES[status];
  const Icon = style.icon;
  return (
    <span className={`badge ${style.badge}`}>
      <Icon size={12} aria-hidden />
      Proof check: {style.label}
    </span>
  );
}

function ProofCheckInfo({
  image,
  currentCycle,
  canOverride,
  onOverride,
}: {
  image: AuthorityIssueImage;
  currentCycle: number;
  canOverride: boolean;
  onOverride: () => void;
}) {
  const style = PROOF_STYLES[image.proof_check_status];
  return (
    <div className="stack" style={{ gap: 8, flex: 1, minWidth: 240 }}>
      <div className="row">
        <ProofStatusBadge status={image.proof_check_status} />
        <span className="subtle">
          Resolution attempt {image.resolution_cycle}
          {image.resolution_cycle === currentCycle ? ' (current)' : ''}
        </span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {style.text}
      </p>
      <KeyValues
        items={[
          [
            'Distance from issue',
            image.distance_from_issue_m !== null ? `${formatDistance(image.distance_from_issue_m)} from the reported location` : 'No GPS position recorded',
          ],
          ['Capture source', CAPTURE_SOURCE_LABELS[image.capture_source]],
          ['GPS accuracy', image.capture_accuracy_m !== null ? `±${Math.round(image.capture_accuracy_m)} m` : '—'],
          ['Captured at', formatDateTime(image.captured_at)],
          ['Uploaded by', image.uploaded_by_name || '—'],
        ]}
      />
      {image.proof_check_notes ? (
        <p style={{ margin: 0 }}>
          <strong>Check notes:</strong> {image.proof_check_notes}
        </p>
      ) : null}
      {image.override_reason ? (
        <p style={{ margin: 0 }}>
          <strong>Override:</strong> “{image.override_reason}” — {image.overridden_by_name ?? 'a supervisor'}
          {image.overridden_at ? `, ${formatDateTime(image.overridden_at)}` : ''}
        </p>
      ) : null}
      {canOverride && image.proof_check_status === 'FLAGGED' ? (
        <div>
          <Button size="sm" variant="outline" icon={ShieldCheck} onClick={onOverride}>
            Review &amp; override
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Lightbox({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: AuthorityIssueImage[];
  index: number;
  onClose: () => void;
  onNavigate: (index: number) => void;
}) {
  const image = images[index];
  const count = images.length;
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowRight' && count > 1) {
        onNavigate((index + 1) % count);
      } else if (event.key === 'ArrowLeft' && count > 1) {
        onNavigate((index - 1 + count) % count);
      } else if (event.key === 'Tab' && containerRef.current) {
        // Keep keyboard focus inside the lightbox while it is open.
        const focusable = Array.from(containerRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), a[href]'));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, count, onClose, onNavigate]);

  if (!image) return null;
  const label = IMAGE_TYPE_LABELS[image.image_type];
  const iconButtonStyle = { color: '#fff' } as const;

  return (
    <div ref={containerRef} className="lightbox" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <div className="lightbox-bar">
        <div style={{ minWidth: 0 }}>
          <strong id={titleId}>
            {label} photo {count > 1 ? `(${index + 1} of ${count})` : ''}
          </strong>
          {image.caption ? <div>{image.caption}</div> : null}
          <div style={{ fontSize: 12, opacity: 0.85 }}>
            Uploaded {formatDateTime(image.uploaded_at)}
            {image.uploaded_by_name ? ` by ${image.uploaded_by_name}` : ''}
            {image.image_type === 'RESOLUTION' ? ` · Proof check: ${PROOF_STYLES[image.proof_check_status].label}` : ''}
          </div>
        </div>
        <div className="row" style={{ flexWrap: 'nowrap' }}>
          {count > 1 ? (
            <>
              <button type="button" className="btn btn-icon" style={iconButtonStyle} aria-label="Previous photo" onClick={() => onNavigate((index - 1 + count) % count)}>
                <ChevronLeft size={22} aria-hidden />
              </button>
              <button type="button" className="btn btn-icon" style={iconButtonStyle} aria-label="Next photo" onClick={() => onNavigate((index + 1) % count)}>
                <ChevronRight size={22} aria-hidden />
              </button>
            </>
          ) : null}
          <a href={image.image_url} target="_blank" rel="noreferrer" className="btn btn-icon" style={iconButtonStyle} aria-label="Open full-size photo in a new tab">
            <ExternalLink size={20} aria-hidden />
          </a>
          <button ref={closeRef} type="button" className="btn btn-icon" style={iconButtonStyle} aria-label="Close photo viewer" onClick={onClose}>
            <X size={22} aria-hidden />
          </button>
        </div>
      </div>
      <img src={image.image_url} alt={image.caption || `${label} photo uploaded ${formatDateTime(image.uploaded_at)}`} />
    </div>
  );
}

function BeforeAfterCard({ issue }: { issue: AuthorityIssueDetail }) {
  const before = useMemo(() => issue.images.filter((image) => image.image_type === 'REPORT').sort(byDate((image) => image.uploaded_at))[0], [issue.images]);
  const after = useMemo(
    () => issue.images.filter((image) => image.image_type === 'RESOLUTION').sort(byDate((image) => image.uploaded_at, 'desc'))[0],
    [issue.images],
  );
  const [position, setPosition] = useState(50);
  const [focused, setFocused] = useState(false);

  if (!before || !after) return null;

  return (
    <Card title="Before and after">
      <div
        className="compare"
        style={focused ? { outline: '3px solid #93c5fd', outlineOffset: 2 } : undefined}
      >
        <img src={after.image_url} alt={`After: resolution photo from ${formatDateTime(after.uploaded_at)}`} />
        <img
          src={before.image_url}
          alt={`Before: reported photo from ${formatDateTime(before.uploaded_at)}`}
          style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}
        />
        <div className="divider" style={{ left: `calc(${position}% - 1.5px)` }} aria-hidden />
        <span className="label" style={{ left: 10 }} aria-hidden>
          Before
        </span>
        <span className="label" style={{ right: 10 }} aria-hidden>
          After
        </span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={position}
          aria-label="Compare before and after"
          aria-valuetext={`${position}% before photo, ${100 - position}% after photo`}
          onChange={(event) => setPosition(Number(event.target.value))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
      </div>
      <p className="subtle" style={{ margin: '8px 0 0' }}>
        Drag the slider or use the arrow keys to compare. After photo: latest resolution upload ({PROOF_STYLES[after.proof_check_status].label.toLowerCase()} proof check).
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Description, history, comments
// ---------------------------------------------------------------------------------------------

function DescriptionCard({ issue }: { issue: AuthorityIssueDetail }) {
  const closureText = issue.status === 'CLOSED' && issue.closure_type ? CLOSURE_TEXT[issue.closure_type] : null;
  return (
    <Card title="Description">
      <div className="stack" style={{ gap: 14 }}>
        <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{issue.description || <span className="muted">No description provided.</span>}</p>

        {issue.additional_details ? (
          <div>
            <h3>Additional details</h3>
            <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{issue.additional_details}</p>
          </div>
        ) : null}

        <div className="row">
          {issue.reported_urgency ? (
            <span className="badge badge-neutral">Citizen felt: {PRIORITY_STYLES[issue.reported_urgency].label}</span>
          ) : null}
          {issue.recommended_priority !== issue.priority ? (
            <span className="badge badge-info">Rules recommend: {PRIORITY_STYLES[issue.recommended_priority].label}</span>
          ) : null}
          {issue.category.is_life_threatening ? (
            <span className="badge badge-danger">
              <AlertTriangle size={12} aria-hidden />
              Life-safety category
            </span>
          ) : null}
          {issue.is_recurrence ? (
            <span className="badge badge-warning">
              <Repeat size={12} aria-hidden />
              Recurrence
              {issue.parent_complaint_id ? (
                <>
                  {' of '}
                  <Link to={issuesLink({ search: issue.parent_complaint_id })} className="mono">
                    {issue.parent_complaint_id}
                  </Link>
                </>
              ) : null}
            </span>
          ) : null}
        </div>

        <KeyValues
          items={[
            ['Category', issue.category.name],
            ['Subcategory', issue.subcategory?.name ?? '—'],
            ['Reported', formatDateTime(issue.created_at)],
            ...(issue.client_reported_at
              ? ([
                  [
                    'Captured offline',
                    <span key="offline" className="row" style={{ gap: 6 }}>
                      <WifiOff size={14} aria-hidden />
                      Captured offline at {formatDateTime(issue.client_reported_at)}, uploaded {formatDateTime(issue.created_at)}
                    </span>,
                  ],
                ] as [string, ReactNode][])
              : []),
          ]}
        />

        {issue.resolution_description ? (
          <div>
            <h3>Resolution notes</h3>
            <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>{issue.resolution_description}</p>
          </div>
        ) : null}

        {issue.satisfaction_rating !== null || issue.satisfaction_comment ? (
          <div>
            <h3>Citizen feedback</h3>
            {issue.satisfaction_rating !== null ? (
              <p className="row" style={{ margin: '4px 0 0', gap: 2 }} aria-label={`Rated ${issue.satisfaction_rating} out of 5`}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Star key={n} size={16} aria-hidden fill={n <= (issue.satisfaction_rating ?? 0) ? '#CA8A04' : 'none'} color="#CA8A04" />
                ))}
                <span style={{ marginLeft: 6 }} aria-hidden>
                  {issue.satisfaction_rating} / 5
                </span>
              </p>
            ) : null}
            {issue.satisfaction_comment ? <p style={{ margin: '4px 0 0', whiteSpace: 'pre-wrap' }}>“{issue.satisfaction_comment}”</p> : null}
          </div>
        ) : null}

        {closureText ? (
          <Banner tone={issue.closure_type === 'AUTO_TIMEOUT' ? 'warning' : 'info'} title="How this issue was closed">
            {closureText}
          </Banner>
        ) : null}
      </div>
    </Card>
  );
}

function HistoryCard({ history }: { history: AuthorityHistoryEntry[] }) {
  const entries = useMemo(() => [...history].sort(byDate((entry) => entry.created_at)), [history]);
  return (
    <Card title="Status history">
      {entries.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No status changes recorded yet.
        </p>
      ) : (
        <ol className="timeline">
          {entries.map((entry) => {
            const style = STATUS_STYLES[entry.new_status];
            const Icon = style.icon;
            return (
              <li key={entry.id}>
                <span className="dot" style={{ background: style.color }} aria-hidden>
                  <Icon size={14} />
                </span>
                <div className="row-between">
                  <strong>{style.longLabel}</strong>
                  <time className="subtle" dateTime={entry.created_at}>
                    {formatDateTime(entry.created_at)}
                  </time>
                </div>
                <div className="subtle">
                  {entry.previous_status ? `From ${STATUS_STYLES[entry.previous_status].label} · ` : ''}By {actorLabel(entry)}
                  {entry.evidence_ids.length ? ` · ${entry.evidence_ids.length} evidence photo${entry.evidence_ids.length === 1 ? '' : 's'}` : ''}
                </div>
                {entry.closure_type ? <p className="reason">{CLOSURE_TEXT[entry.closure_type]}</p> : null}
                {entry.reason ? <p className="reason">{entry.reason}</p> : null}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}

function VisibilityBadge({ visibility }: { visibility: CommentVisibility }) {
  return visibility === 'INTERNAL' ? (
    <span className="badge badge-warning">
      <Lock size={12} aria-hidden />
      Internal
    </span>
  ) : (
    <span className="badge badge-info">
      <Eye size={12} aria-hidden />
      Visible to citizen
    </span>
  );
}

function CommentsCard({ issue, canComment, onPosted }: { issue: AuthorityIssueDetail; canComment: boolean; onPosted: (comment: Comment) => void }) {
  const comments = useMemo(() => [...issue.comments].sort(byDate((comment) => comment.created_at)), [issue.comments]);
  return (
    <Card title={`Comments (${comments.length})`}>
      {comments.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>
          No comments yet.
        </p>
      ) : (
        <ul className="stack" style={{ ...LIST_RESET, gap: 14, marginBottom: canComment ? 20 : 0 }}>
          {comments.map((comment) => (
            <li
              key={comment.id}
              style={{ borderLeft: `3px solid ${comment.visibility === 'INTERNAL' ? 'var(--c-warning)' : 'var(--c-info)'}`, paddingLeft: 12 }}
            >
              <div className="row-between">
                <div className="row" style={{ gap: 6 }}>
                  <strong>{comment.author_name}</strong>
                  <span className="subtle">
                    {ROLE_LABELS[comment.author_role]}
                    {comment.is_mine ? ' · You' : ''}
                  </span>
                </div>
                <VisibilityBadge visibility={comment.visibility} />
              </div>
              <p style={{ margin: '4px 0', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{comment.comment}</p>
              <time className="subtle" dateTime={comment.created_at}>
                {formatDateTime(comment.created_at)}
              </time>
            </li>
          ))}
        </ul>
      )}
      {canComment ? <CommentForm issueId={issue.id} onPosted={onPosted} /> : null}
    </Card>
  );
}

function CommentForm({ issueId, onPosted }: { issueId: number; onPosted: (comment: Comment) => void }) {
  const { busy, run } = useAction();
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<CommentVisibility>('INTERNAL');
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value) {
      setFieldError('Write a comment before posting.');
      return;
    }
    setFormError(null);
    try {
      const comment = await run(() => authorityApi.comment(issueId, value, visibility));
      if (!comment) return;
      setText('');
      onPosted(comment);
    } catch (err) {
      const apiError = toApiError(err);
      const message = apiError.fieldError('comment');
      if (message) setFieldError(message);
      else setFormError(apiError.message);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Add a comment" noValidate>
      {formError ? <Banner tone="danger">{formError}</Banner> : null}
      <TextArea
        label="Add a comment"
        value={text}
        maxLength={2000}
        placeholder={visibility === 'INTERNAL' ? 'Note for other staff…' : 'Update for the reporter…'}
        onChange={(event) => {
          setText(event.target.value);
          setFieldError(undefined);
        }}
        error={fieldError}
        hint={visibility === 'INTERNAL' ? 'Internal comments are only visible to authority staff.' : 'The reporter will see this comment and be notified.'}
      />
      <div className="row-between">
        <Segmented<CommentVisibility>
          label="Comment visibility"
          options={[
            { value: 'CITIZEN_VISIBLE', label: 'Visible to citizen' },
            { value: 'INTERNAL', label: 'Internal only' },
          ]}
          value={visibility}
          onChange={setVisibility}
        />
        <Button type="submit" icon={visibility === 'INTERNAL' ? MessageSquare : Send} loading={busy}>
          {visibility === 'INTERNAL' ? 'Post internal comment' : 'Post comment'}
        </Button>
      </div>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------
// Side column
// ---------------------------------------------------------------------------------------------

function LocationCard({ issue }: { issue: AuthorityIssueDetail }) {
  const { id, latitude, longitude, priority, status, title, complaint_id, is_overdue } = issue;
  const points = useMemo<MapPoint[]>(
    () => [{ id, latitude, longitude, priority, status, title, complaint_id, is_overdue }],
    [id, latitude, longitude, priority, status, title, complaint_id, is_overdue],
  );
  const query = `${latitude},${longitude}`;
  return (
    <Card title="Location">
      <div className="stack" style={{ gap: 12 }}>
        <IssueMap points={points} className="map" />
        <KeyValues
          items={[
            ['Address', issue.address || '—'],
            ['Coordinates', <span key="coordinates" className="mono">{formatCoordinate(latitude, longitude)}</span>],
            ['GPS accuracy', issue.location_accuracy_m !== null ? `±${Math.round(issue.location_accuracy_m)} m` : '—'],
            ['Service area', issue.service_area_name ?? '—'],
          ]}
        />
        <div className="row">
          <a className="btn btn-outline btn-sm" href={`https://www.google.com/maps/search/?api=1&query=${query}`} target="_blank" rel="noreferrer">
            <MapPin size={16} aria-hidden />
            Open in Google Maps
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
          <a className="btn btn-outline btn-sm" href={`https://www.google.com/maps/dir/?api=1&destination=${query}`} target="_blank" rel="noreferrer">
            <Navigation size={16} aria-hidden />
            Directions
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </div>
      </div>
    </Card>
  );
}

function ReporterCard({ issue }: { issue: AuthorityIssueDetail }) {
  const { reporter } = issue;
  return (
    <Card title="Reporter">
      <KeyValues
        items={[
          ['Name', reporter.full_name || '—'],
          [
            'Phone',
            reporter.phone_number ? (
              <a key="phone" href={`tel:${reporter.phone_number.replace(/[^\d+]/g, '')}`} className="row" style={{ display: 'inline-flex', gap: 6 }}>
                <Phone size={14} aria-hidden />
                {reporter.phone_number}
              </a>
            ) : (
              '—'
            ),
          ],
          [
            'Email',
            reporter.email ? (
              <a key="email" href={`mailto:${reporter.email}`} className="row" style={{ display: 'inline-flex', gap: 6 }}>
                <Mail size={14} aria-hidden />
                {reporter.email}
              </a>
            ) : (
              '—'
            ),
          ],
        ]}
      />
      <p className="subtle row" style={{ margin: '12px 0 0', gap: 6 }}>
        <Lock size={12} aria-hidden />
        Visible to authorised staff only. Do not share outside official duties.
      </p>
    </Card>
  );
}

/** Current time, re-read every minute so SLA countdowns stay accurate while the page is open. */
function useNow(intervalMs = 60000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(timer);
  }, [intervalMs]);
  return now;
}

function SlaValue({ due, completedAt, now }: { due: string | null; completedAt: string | null; now: number }) {
  if (!due) return <span className="muted">No deadline</span>;
  if (completedAt) {
    const late = new Date(completedAt).getTime() > new Date(due).getTime();
    return (
      <span className="row" style={{ gap: 6 }}>
        {formatDateTime(due)}
        <span className={`badge ${late ? 'badge-danger' : 'badge-success'}`}>{late ? 'Met late' : 'Met on time'}</span>
      </span>
    );
  }
  const overdue = new Date(due).getTime() < now;
  return (
    <span style={overdue ? { color: 'var(--c-danger)', fontWeight: 700 } : undefined}>
      {overdue ? <AlertTriangle size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} /> : null}
      {formatDue(due, new Date(now))}
      <span className="subtle" style={{ display: 'block', fontWeight: 400 }}>
        {formatDateTime(due)}
      </span>
    </span>
  );
}

function SlaCard({ issue }: { issue: AuthorityIssueDetail }) {
  const now = useNow();
  const resolvedNow = issue.status === 'RESOLVED' || issue.status === 'CLOSED';
  const items: [string, ReactNode][] = [
    ['Department', issue.department?.name ?? <span key="dept" className="muted">Not assigned</span>],
    ['Assigned officer', issue.assigned_officer?.full_name ?? <span key="officer" className="muted">No specific officer</span>],
    ['Service area', issue.service_area_name ?? '—'],
    ['Reported', formatDateTime(issue.created_at)],
    ['Days open', `${issue.days_open} day${issue.days_open === 1 ? '' : 's'}`],
    ['Acknowledge by', <SlaValue key="ack" due={issue.ack_due_at} completedAt={issue.acknowledged_at} now={now} />],
    ['Resolve by', <SlaValue key="due" due={issue.due_at} completedAt={resolvedNow ? issue.resolved_at : null} now={now} />],
    ['Acknowledged', formatDateTime(issue.acknowledged_at)],
    ['Work started', formatDateTime(issue.started_at)],
    ['Resolved', formatDateTime(issue.resolved_at)],
    ['Closed', formatDateTime(issue.closed_at)],
    ['Reopened', formatDateTime(issue.reopened_at)],
    ['Times reopened', String(issue.reopen_count)],
  ];
  return (
    <Card title="SLA & assignment">
      <KeyValues items={items} />
    </Card>
  );
}

function PriorityChangesCard({ issue }: { issue: AuthorityIssueDetail }) {
  const changes = useMemo(() => [...issue.priority_changes].sort(byDate((change) => change.created_at, 'desc')), [issue.priority_changes]);
  return (
    <Card title="Priority changes">
      {changes.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          The priority has not been changed.
        </p>
      ) : (
        <ul className="stack" style={{ ...LIST_RESET, gap: 14 }}>
          {changes.map((change) => (
            <li key={change.id}>
              <div className="row" style={{ gap: 6 }}>
                <PriorityBadge priority={change.previous_priority} />
                <ArrowRight size={14} aria-hidden />
                <span className="sr-only">changed to</span>
                <PriorityBadge priority={change.new_priority} />
              </div>
              {change.reason ? <p className="reason" style={{ margin: '4px 0 0', color: 'var(--c-text-muted)', whiteSpace: 'pre-wrap' }}>{change.reason}</p> : null}
              <div className="subtle">
                {change.changed_by_name || 'System'} · <time dateTime={change.created_at}>{formatDateTime(change.created_at)}</time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function AssignmentsCard({ issue }: { issue: AuthorityIssueDetail }) {
  const assignments = useMemo(() => [...issue.assignments].sort(byDate((assignment) => assignment.assigned_at, 'desc')), [issue.assignments]);
  return (
    <Card title="Assignment history">
      {assignments.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No assignments recorded.
        </p>
      ) : (
        <ul className="stack" style={{ ...LIST_RESET, gap: 14 }}>
          {assignments.map((assignment) => (
            <li key={assignment.id}>
              <div className="row-between">
                <strong>{assignment.department.name}</strong>
                {assignment.is_current ? (
                  <span className="badge badge-success">
                    <CheckCircle2 size={12} aria-hidden />
                    Current
                  </span>
                ) : null}
              </div>
              <div>{assignment.assigned_officer?.full_name ?? <span className="muted">No specific officer</span>}</div>
              {assignment.notes ? <p style={{ margin: '4px 0 0', color: 'var(--c-text-muted)', whiteSpace: 'pre-wrap' }}>{assignment.notes}</p> : null}
              <div className="subtle">
                By {assignment.assigned_by_name || 'System'} · <time dateTime={assignment.assigned_at}>{formatDateTime(assignment.assigned_at)}</time>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------------------------
// Change priority
// ---------------------------------------------------------------------------------------------

function PriorityModal({
  issue,
  onClose,
  onSuccess,
  onStale,
}: {
  issue: AuthorityIssueDetail;
  onClose: () => void;
  onSuccess: (result: AuthorityIssueDetail, message: string) => void;
  onStale: (error: ApiError) => void;
}) {
  const { busy, run } = useAction();
  const [priority, setPriority] = useState<Priority>(issue.priority);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ priority?: string; reason?: string; form?: string }>({});

  async function submit() {
    const next: typeof errors = {};
    if (priority === issue.priority) next.priority = `The issue is already ${PRIORITY_STYLES[priority].label}. Choose a different priority.`;
    if (reason.trim().length < 3) next.reason = 'Give a short reason (at least 3 characters).';
    setErrors(next);
    if (next.priority || next.reason) return;
    try {
      const result = await run(() => authorityApi.changePriority(issue.id, priority, reason.trim()));
      if (result) onSuccess(result, `Priority changed to ${PRIORITY_STYLES[result.priority].label}.`);
    } catch (err) {
      const apiError = toApiError(err);
      if (apiError.code === 'no_change') setErrors({ priority: 'The issue already has this priority.' });
      else if (isStaleError(apiError)) onStale(apiError);
      else setErrors({ priority: apiError.fieldError('priority'), reason: apiError.fieldError('reason'), form: apiError.fieldError('reason') || apiError.fieldError('priority') ? undefined : apiError.message });
    }
  }

  return (
    <Modal
      open
      title="Change priority"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button icon={Flag} onClick={submit} loading={busy}>
            Change priority
          </Button>
        </>
      }
    >
      {errors.form ? <Banner tone="danger">{errors.form}</Banner> : null}
      <p className="muted" style={{ marginTop: 0 }}>
        Current priority: <PriorityBadge priority={issue.priority} />
        {issue.recommended_priority !== issue.priority ? (
          <>
            {' '}
            · Rules recommend: <PriorityBadge priority={issue.recommended_priority} />
          </>
        ) : null}
      </p>
      <div className="field">
        <span style={{ fontWeight: 600, fontSize: 13 }} id="new-priority-label">
          New priority
        </span>
        <ChipGroup<Priority>
          label="New priority"
          options={PRIORITY_ORDER.map((value) => ({ value, label: PRIORITY_STYLES[value].label }))}
          selected={[priority]}
          onToggle={(value) => {
            setPriority(value);
            setErrors((prev) => ({ ...prev, priority: undefined }));
          }}
        />
        {errors.priority ? (
          <span className="error" role="alert">
            {errors.priority}
          </span>
        ) : (
          <span className="hint">Changing the priority recalculates the SLA deadlines and notifies the reporter.</span>
        )}
      </div>
      <TextArea
        label="Reason"
        value={reason}
        maxLength={2000}
        placeholder="Why is the priority changing?"
        onChange={(event) => {
          setReason(event.target.value);
          setErrors((prev) => ({ ...prev, reason: undefined }));
        }}
        error={errors.reason}
      />
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Assign
// ---------------------------------------------------------------------------------------------

function AssignModal({
  issue,
  user,
  onClose,
  onAssigned,
  onStale,
}: {
  issue: AuthorityIssueDetail;
  user: User | null;
  onClose: () => void;
  onAssigned: (result: AuthorityIssueDetail) => void;
  onStale: (error: ApiError) => void;
}) {
  const { busy, run } = useAction();
  const departments = useReferenceStore((s) => s.departments);
  const loadReference = useReferenceStore((s) => s.load);
  const [referenceError, setReferenceError] = useState<string | null>(null);
  const restricted = user?.role === 'OFFICER';

  useEffect(() => {
    loadReference().catch((err: unknown) => setReferenceError(toApiError(err).message));
  }, [loadReference]);

  const departmentOptions = useMemo<DepartmentMini[]>(() => {
    // Officers may only assign within the issue's current department; moving it elsewhere is a supervisor action.
    if (restricted) {
      const own = issue.department ?? user?.department ?? null;
      return own ? [own] : [];
    }
    const list: DepartmentMini[] = departments.map((department) => ({ id: department.id, name: department.name }));
    if (issue.department && !list.some((department) => department.id === issue.department?.id)) list.unshift(issue.department);
    return list;
  }, [restricted, issue.department, user?.department, departments]);

  const [departmentId, setDepartmentId] = useState<number | ''>(issue.department?.id ?? (restricted ? (user?.department?.id ?? '') : ''));
  const [officerId, setOfficerId] = useState<number | ''>(issue.assigned_officer?.id ?? '');
  const [notes, setNotes] = useState('');
  const [officers, setOfficers] = useState<User[]>([]);
  // The loading state is set where the department changes (initial state / select handler), the effect only fetches.
  const [officersState, setOfficersState] = useState<{ status: 'idle' | 'loading' | 'ready' | 'error'; message?: string }>(() => ({
    status: departmentId === '' ? 'idle' : 'loading',
  }));
  const [errors, setErrors] = useState<{ department?: string; officer?: string; notes?: string; form?: string }>({});

  useEffect(() => {
    if (departmentId === '') return;
    let cancelled = false;
    authorityApi
      // Only officers whose service areas cover this issue's location can be assigned.
      .officers(departmentId, issue.id)
      .then((list) => {
        if (cancelled) return;
        setOfficers(list.filter((officer) => !officer.department || officer.department.id === departmentId));
        setOfficersState({ status: 'ready' });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOfficers([]);
        setOfficersState({ status: 'error', message: toApiError(err).message });
      });
    return () => {
      cancelled = true;
    };
  }, [departmentId, issue.id]);

  // Keep the currently assigned officer selectable even if the list no longer returns them.
  const officerOptions = useMemo(() => {
    const current = issue.assigned_officer;
    if (current && departmentId === issue.department?.id && !officers.some((officer) => officer.id === current.id)) {
      return [{ id: current.id, full_name: current.full_name, role: null as User['role'] | null }, ...officers.map((o) => ({ id: o.id, full_name: o.full_name, role: o.role as User['role'] | null }))];
    }
    return officers.map((o) => ({ id: o.id, full_name: o.full_name, role: o.role as User['role'] | null }));
  }, [officers, issue.assigned_officer, issue.department?.id, departmentId]);

  const selectedDepartment = departmentOptions.find((department) => department.id === departmentId) ?? null;
  const transferring = departmentId !== '' && departmentId !== issue.department?.id;
  const losesAccess = transferring && user?.role !== 'ADMIN' && departmentId !== user?.department?.id && (officerId === '' || officerId !== user?.id);

  async function submit() {
    if (departmentId === '') {
      setErrors({ department: 'Choose a department.' });
      return;
    }
    const nextOfficer = officerId === '' ? null : officerId;
    if (!transferring && nextOfficer === (issue.assigned_officer?.id ?? null) && !notes.trim()) {
      setErrors({ form: 'Nothing has changed. Choose a different department or officer, or add a note.' });
      return;
    }
    setErrors({});
    try {
      const result = await run(() => authorityApi.assign(issue.id, departmentId, nextOfficer, notes.trim()));
      if (result) onAssigned(result);
    } catch (err) {
      const apiError = toApiError(err);
      if (apiError.code === 'invalid_transition' || apiError.code === 'issue_closed') {
        onStale(apiError);
        return;
      }
      if (apiError.status === 403) {
        setErrors({ form: apiError.message || 'You do not have permission to move this issue to another department.' });
        return;
      }
      const department = apiError.fieldError('department_id');
      const officer = apiError.fieldError('officer_id');
      const notesError = apiError.fieldError('notes');
      setErrors({
        department: department ?? (apiError.status === 404 ? 'This department is no longer available.' : undefined),
        officer,
        notes: notesError,
        form: department || officer || notesError || apiError.status === 404 ? undefined : apiError.message,
      });
    }
  }

  return (
    <Modal
      open
      title="Assign issue"
      onClose={() => !busy && onClose()}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button icon={Users} onClick={submit} loading={busy} disabled={departmentId === ''}>
            {transferring ? 'Transfer issue' : 'Save assignment'}
          </Button>
        </>
      }
    >
      {errors.form ? <Banner tone="danger">{errors.form}</Banner> : null}
      {referenceError && !restricted ? (
        <Banner tone="warning" title="Couldn't load the department list">
          {referenceError}
        </Banner>
      ) : null}
      <Select
        label="Department"
        value={departmentId === '' ? '' : String(departmentId)}
        onChange={(event) => {
          const value = event.target.value;
          setDepartmentId(value === '' ? '' : Number(value));
          setOfficerId('');
          setOfficers([]);
          setOfficersState({ status: value === '' ? 'idle' : 'loading' });
          setErrors({});
        }}
        disabled={restricted || busy}
        error={errors.department}
        hint={restricted ? 'Officers can assign within the current department only. Ask a supervisor to transfer it to another department.' : undefined}
      >
        {departmentId === '' ? <option value="">Choose a department…</option> : null}
        {departmentOptions.map((department) => (
          <option key={department.id} value={department.id}>
            {department.name}
            {department.id === issue.department?.id ? ' (current)' : ''}
          </option>
        ))}
      </Select>

      <Select
        label="Officer"
        value={officerId === '' ? '' : String(officerId)}
        onChange={(event) => {
          setOfficerId(event.target.value === '' ? '' : Number(event.target.value));
          setErrors((prev) => ({ ...prev, officer: undefined, form: undefined }));
        }}
        disabled={departmentId === '' || officersState.status === 'loading' || busy}
        error={errors.officer ?? (officersState.status === 'error' ? `Couldn't load officers: ${officersState.message}` : undefined)}
        hint={officersState.status === 'loading' ? 'Loading officers…' : officersState.status === 'ready' && officerOptions.length === 0 ? 'No officers are available in this department.' : undefined}
      >
        <option value="">No specific officer</option>
        {officerOptions.map((officer) => (
          <option key={officer.id} value={officer.id}>
            {officer.full_name}
            {officer.role ? ` — ${ROLE_LABELS[officer.role]}` : ''}
            {officer.id === user?.id ? ' (you)' : ''}
          </option>
        ))}
      </Select>

      <TextArea
        label="Notes (optional)"
        value={notes}
        maxLength={2000}
        placeholder="Instructions for the assignee"
        onChange={(event) => setNotes(event.target.value)}
        error={errors.notes}
      />

      {transferring ? (
        <Banner tone="warning" title={`Transfer to ${selectedDepartment?.name ?? 'another department'}`}>
          The issue moves to the new department's queue and its staff are notified.
          {losesAccess ? ' You will no longer have access to this issue after the transfer.' : ''}
        </Banner>
      ) : null}
    </Modal>
  );
}

// ---------------------------------------------------------------------------------------------
// Resolve
// ---------------------------------------------------------------------------------------------

interface PickedFile {
  file: File;
  url: string;
}

type GeoState =
  | { status: 'off' }
  | { status: 'locating' }
  | { status: 'ready'; latitude: number; longitude: number; accuracy: number }
  | { status: 'error'; message: string };

/** Capture metadata for a dashboard upload: always GALLERY, with the browser position when attached. */
function captureFromGeo(geo: GeoState): ResolutionCapture {
  const located = geo.status === 'ready' ? geo : null;
  return {
    capture_source: 'GALLERY',
    capture_latitude: located ? roundTo(located.latitude, 6) : null,
    capture_longitude: located ? roundTo(located.longitude, 6) : null,
    capture_accuracy_m: located ? roundTo(located.accuracy, 1) : null,
    captured_at: new Date().toISOString(),
  };
}

function ResolveModal({
  issue,
  canOverride,
  onClose,
  onResolved,
  onStale,
  onRefresh,
}: {
  issue: AuthorityIssueDetail;
  canOverride: boolean;
  onClose: () => void;
  onResolved: (result: AuthorityIssueDetail) => void;
  onStale: (error: ApiError) => void;
  onRefresh: () => void;
}) {
  const { busy, run } = useAction();
  const config = useReferenceStore((s) => s.config);
  const loadReference = useReferenceStore((s) => s.load);
  const proofLockOn = useReferenceStore((s) => s.isEnabled('proof_lock'));
  const maxDistance = useReferenceStore((s) => s.featureConfig('proof_lock', 'max_distance_m', 50));
  const maxFiles = Math.min(MAX_RESOLUTION_FILES, config?.policies.max_images_per_upload ?? MAX_RESOLUTION_FILES);
  const maxSizeMb = config?.policies.max_image_size_mb ?? 10;

  const photosLabelId = useId();
  const photosHintId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<PickedFile[]>([]);
  const pickedRef = useRef<PickedFile[]>([]);
  const [fileProblems, setFileProblems] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [descriptionError, setDescriptionError] = useState<string | undefined>();
  const [geo, setGeo] = useState<GeoState>({ status: 'off' });
  const geoRequest = useRef(0);
  const [error, setError] = useState<ApiError | null>(null);
  const [flagged, setFlagged] = useState<AuthorityIssueImage[]>([]);
  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  useEffect(() => {
    loadReference().catch(() => {
      // Falls back to default limits; the backend enforces the real ones.
    });
  }, [loadReference]);

  // Release preview URLs and ignore pending location lookups when the dialog goes away.
  useEffect(
    () => () => {
      pickedRef.current.forEach((item) => URL.revokeObjectURL(item.url));
      pickedRef.current = [];
      geoRequest.current += 1;
    },
    [],
  );

  function updatePicked(next: PickedFile[]) {
    pickedRef.current = next;
    setPicked(next);
  }

  function clearPicked() {
    picked.forEach((item) => URL.revokeObjectURL(item.url));
    updatePicked([]);
  }

  const hasAcceptedPhoto = issue.images.some((image) => isAcceptedResolution(image, issue.resolution_cycle));
  const cycleFlagged = issue.images.filter(
    (image) => image.image_type === 'RESOLUTION' && image.resolution_cycle === issue.resolution_cycle && image.proof_check_status === 'FLAGGED',
  );
  // Flagged photos from the last attempt plus any still-flagged photos of this cycle (after a refresh).
  const flaggedToReview = useMemo(() => {
    const byId = new Map<number, AuthorityIssueImage>();
    flagged.filter((image) => image.proof_check_status === 'FLAGGED').forEach((image) => byId.set(image.id, image));
    cycleFlagged.forEach((image) => byId.set(image.id, image));
    return [...byId.values()];
  }, [flagged, cycleFlagged]);

  function onFilesChosen(event: ChangeEvent<HTMLInputElement>) {
    const chosen = Array.from(event.target.files ?? []);
    event.target.value = '';
    const problems: string[] = [];
    const added: PickedFile[] = [];
    for (const file of chosen) {
      if (!ACCEPTED_FILE_TYPES.includes(file.type)) {
        problems.push(`${file.name}: only JPEG, PNG or WebP photos are accepted.`);
        continue;
      }
      if (file.size > maxSizeMb * 1024 * 1024) {
        problems.push(`${file.name}: larger than ${maxSizeMb} MB.`);
        continue;
      }
      if (picked.length + added.length >= maxFiles) {
        problems.push(`You can attach up to ${maxFiles} photos.`);
        break;
      }
      added.push({ file, url: URL.createObjectURL(file) });
    }
    if (added.length) {
      updatePicked([...picked, ...added]);
      setError((prev) => (prev?.code === 'resolution_evidence_required' ? null : prev));
    }
    setFileProblems(problems);
  }

  function removePicked(index: number) {
    const item = picked[index];
    if (!item) return;
    URL.revokeObjectURL(item.url);
    updatePicked(picked.filter((_, i) => i !== index));
  }

  function requestLocation() {
    const requestId = ++geoRequest.current;
    if (!('geolocation' in navigator)) {
      setGeo({ status: 'error', message: 'This browser cannot share its location.' });
      return;
    }
    setGeo({ status: 'locating' });
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (requestId !== geoRequest.current) return;
        setGeo({ status: 'ready', latitude: position.coords.latitude, longitude: position.coords.longitude, accuracy: position.coords.accuracy });
      },
      (geoError) => {
        if (requestId !== geoRequest.current) return;
        setGeo({ status: 'error', message: geolocationErrorMessage(geoError) });
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 },
    );
  }

  function toggleLocation(checked: boolean) {
    if (checked) {
      requestLocation();
    } else {
      geoRequest.current += 1;
      setGeo({ status: 'off' });
    }
  }

  function validateDescription() {
    if (description.trim().length < 3) {
      setDescriptionError('Describe the work that was done.');
      return false;
    }
    return true;
  }

  function handleError(apiError: ApiError) {
    if (isStaleError(apiError)) {
      onStale(apiError);
      return;
    }
    if (apiError.code === 'proof_check_flagged') {
      // The photos were stored server-side for review; don't upload them again.
      clearPicked();
      setFlagged(flaggedImagesFrom(apiError.details));
      setError(apiError);
      onRefresh();
      return;
    }
    const fieldMessage = apiError.fieldError('resolution_description');
    if (fieldMessage) setDescriptionError(fieldMessage);
    setError(apiError);
  }

  async function submit() {
    if (!validateDescription()) return;
    if (geo.status === 'locating') return;
    setError(null);
    try {
      const result = await run(() => authorityApi.resolve(issue.id, description.trim(), picked.map((item) => item.file), captureFromGeo(geo)));
      if (result) onResolved(result);
    } catch (err) {
      handleError(toApiError(err));
    }
  }

  function startOverride() {
    if (!validateDescription()) return;
    setOverrideError(null);
    setOverrideOpen(true);
  }

  async function overrideAndResolve(reason: string) {
    setOverrideError(null);
    const targets = flaggedToReview;
    try {
      const result = await run(async () => {
        for (const image of targets) {
          try {
            await authorityApi.overrideProofCheck(image.id, reason);
          } catch (err) {
            const apiError = toApiError(err);
            if (apiError.code !== 'not_flagged') throw apiError;
          }
        }
        return authorityApi.resolve(issue.id, description.trim(), [], { capture_source: 'GALLERY' });
      });
      if (result) {
        setOverrideOpen(false);
        onResolved(result);
      }
    } catch (err) {
      const apiError = toApiError(err);
      const reasonError = apiError.fieldError('reason');
      if (reasonError) {
        setOverrideError(reasonError);
        return;
      }
      setOverrideOpen(false);
      onRefresh();
      handleError(apiError);
    }
  }

  const distanceFromIssue = geo.status === 'ready' ? haversineMetres(issue.latitude, issue.longitude, geo.latitude, geo.longitude) : null;
  const submitLabel = picked.length === 0 && hasAcceptedPhoto ? 'Resolve with accepted photo' : 'Submit resolution';

  return (
    <>
      <Modal
        open
        wide
        title="Submit resolution"
        onClose={() => {
          if (!busy && !overrideOpen) onClose();
        }}
        footer={
          <>
            <Button variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button variant="success" icon={CheckCircle2} onClick={submit} loading={busy && !overrideOpen} disabled={geo.status === 'locating' || busy}>
              {submitLabel}
            </Button>
          </>
        }
      >
        <ResolveErrorBanner error={error} flagged={flaggedToReview} canOverride={canOverride} busy={busy} onOverride={startOverride} />

        {proofLockOn ? (
          <Banner tone="info" title="Proof-Lock is on">
            <p>
              Resolution photos must be taken at the issue location (within {maxDistance} m) and must not be re-used images. The normal way to
              resolve is the <strong>in-app camera of the CivicEye mobile app</strong>, which records GPS automatically.
            </p>
            <p style={{ marginTop: 6 }}>
              Photos uploaded from this dashboard are recorded as <strong>gallery uploads</strong> and may be rejected (“camera required”) unless
              your department allows dashboard uploads. Attach your current location if you are on site.
            </p>
          </Banner>
        ) : (
          <p className="muted" style={{ marginTop: 0 }}>
            Add photos of the fixed condition and describe the work. The reporter will be asked to verify the fix.
          </p>
        )}

        {hasAcceptedPhoto ? (
          <Banner tone="success" title="Accepted photo on file">
            An accepted resolution photo for this attempt is already on file. You can submit without adding new photos — the accepted photo will be
            used as evidence.
          </Banner>
        ) : null}

        <TextArea
          label="What was done?"
          value={description}
          maxLength={5000}
          placeholder="Describe the work carried out to fix the issue."
          onChange={(event) => {
            setDescription(event.target.value);
            setDescriptionError(undefined);
          }}
          error={descriptionError}
          required
        />

        <div className="field" role="group" aria-labelledby={photosLabelId}>
          <span id={photosLabelId} style={{ fontWeight: 600, fontSize: 13 }}>
            Resolution photos {hasAcceptedPhoto ? '(optional)' : ''}
          </span>
          <div className="row">
            <Button
              variant="outline"
              size="sm"
              icon={Upload}
              onClick={() => fileInputRef.current?.click()}
              disabled={picked.length >= maxFiles || busy}
              aria-describedby={photosHintId}
            >
              Choose photos
            </Button>
            <span id={photosHintId} className="subtle">
              {picked.length} of {maxFiles} selected · JPEG, PNG or WebP, up to {maxSizeMb} MB each
            </span>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_FILE_TYPES.join(',')}
            multiple
            hidden
            tabIndex={-1}
            aria-hidden
            onChange={onFilesChosen}
          />
          {fileProblems.length ? (
            <ul className="error" role="alert" style={{ margin: 0, paddingLeft: 18 }}>
              {fileProblems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}
        </div>

        {picked.length ? (
          <ul className="photos" style={{ ...LIST_RESET, marginBottom: 14 }} aria-label="Selected photos">
            {picked.map((item, index) => (
              <li key={item.url} style={{ position: 'relative', width: 132 }}>
                <img src={item.url} alt={`Selected photo ${index + 1}: ${item.file.name}`} style={{ width: 132, height: 132, objectFit: 'cover', borderRadius: 'var(--radius)', display: 'block' }} />
                <span className="subtle" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.file.name}
                </span>
                <Button
                  variant="icon"
                  size="sm"
                  icon={Trash2}
                  aria-label={`Remove ${item.file.name}`}
                  onClick={() => removePicked(index)}
                  disabled={busy}
                  style={{ position: 'absolute', top: 4, right: 4, minWidth: 34, background: 'rgba(255,255,255,0.9)' }}
                />
              </li>
            ))}
          </ul>
        ) : null}

        <div className="field">
          <label className="checkbox">
            <input type="checkbox" checked={geo.status !== 'off'} onChange={(event) => toggleLocation(event.target.checked)} disabled={busy} />
            <LocateFixed size={16} aria-hidden />
            Attach my current location
          </label>
          <div aria-live="polite">
            {geo.status === 'locating' ? <span className="hint">Getting your location…</span> : null}
            {geo.status === 'ready' ? (
              <span className="hint">
                Location attached: <span className="mono">{formatCoordinate(geo.latitude, geo.longitude)}</span> (±{Math.round(geo.accuracy)} m)
                {distanceFromIssue !== null ? ` · ${formatDistance(distanceFromIssue)} from the reported location` : ''}
                {distanceFromIssue !== null && proofLockOn && distanceFromIssue > maxDistance ? (
                  <strong style={{ color: 'var(--c-danger)', display: 'block' }}>
                    You are farther than {maxDistance} m from the issue — Proof-Lock will likely flag these photos.
                  </strong>
                ) : null}
              </span>
            ) : null}
            {geo.status === 'error' ? (
              <span className="error" role="alert">
                {geo.message}{' '}
                <button type="button" className="btn btn-ghost btn-sm" onClick={requestLocation}>
                  Try again
                </button>
              </span>
            ) : null}
            {geo.status === 'off' ? (
              <span className="hint">Without a location, Proof-Lock cannot confirm the photos were taken at the issue.</span>
            ) : null}
          </div>
        </div>
      </Modal>

      <ReasonDialog
        open={overrideOpen}
        title="Override and resolve"
        message={
          <span>
            {flaggedToReview.length === 1 ? 'The flagged photo' : `The ${flaggedToReview.length} flagged photos`} will be accepted as evidence and the issue
            resolved. Your name and reason are recorded in the audit log.
          </span>
        }
        label="Reason for accepting"
        placeholder="e.g. Verified on a site visit; GPS drift near the flyover."
        confirmLabel="Override and resolve"
        busy={busy}
        error={overrideError}
        onCancel={() => setOverrideOpen(false)}
        onConfirm={overrideAndResolve}
      />
    </>
  );
}

function ResolveErrorBanner({
  error,
  flagged,
  canOverride,
  busy,
  onOverride,
}: {
  error: ApiError | null;
  flagged: AuthorityIssueImage[];
  canOverride: boolean;
  busy: boolean;
  onOverride: () => void;
}) {
  if (!error) return null;

  if (error.code === 'camera_required') {
    return (
      <Banner tone="warning" title="Resolve this issue from the CivicEye mobile app">
        <p>
          Proof-Lock requires resolution photos taken with the in-app camera at the issue location. Photos uploaded from this dashboard count as
          gallery uploads, which this department does not accept.
        </p>
        <p style={{ marginTop: 6 }}>
          <Camera size={14} aria-hidden style={{ verticalAlign: '-2px', marginRight: 4 }} />
          Open the issue in the CivicEye mobile app and use the Proof-Lock camera, or ask an administrator to enable the gallery-upload exception for
          the department.
        </p>
      </Banner>
    );
  }

  if (error.code === 'resolution_evidence_required') {
    return (
      <Banner tone="danger" title="A photo is required">
        {error.message} Add at least one photo of the fixed condition and submit again.
      </Banner>
    );
  }

  if (error.code === 'proof_check_flagged') {
    return (
      <Banner tone="danger" title="Photo flagged by Proof-Lock">
        <p>{error.message}</p>
        {flagged.length ? (
          <ul style={{ ...LIST_RESET, marginTop: 8 }} className="stack">
            {flagged.map((image) => (
              <li key={image.id} className="row" style={{ alignItems: 'flex-start', gap: 10, flexWrap: 'nowrap' }}>
                <img
                  src={image.thumbnail_url || image.image_url}
                  alt="Flagged resolution photo"
                  style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 'var(--radius-sm)', flexShrink: 0 }}
                />
                <div>
                  <div>{image.proof_check_notes || 'The photo did not pass the location/originality check.'}</div>
                  <div className="subtle" style={{ color: 'inherit' }}>
                    Distance from issue: {image.distance_from_issue_m !== null ? formatDistance(image.distance_from_issue_m) : 'no GPS position recorded'} · Source:{' '}
                    {CAPTURE_SOURCE_LABELS[image.capture_source]}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        <p style={{ marginTop: 8 }}>The photos were saved for review — you don't need to upload them again.</p>
        {canOverride && flagged.length ? (
          <div style={{ marginTop: 8 }}>
            <Button size="sm" variant="outline" icon={ShieldCheck} onClick={onOverride} disabled={busy}>
              Override and resolve
            </Button>
          </div>
        ) : (
          <p style={{ marginTop: 8 }}>
            Ask a supervisor to review the flagged photo, or retake it at the issue location with the CivicEye mobile app and submit again.
          </p>
        )}
      </Banner>
    );
  }

  return (
    <Banner tone="danger" title="Couldn't submit the resolution">
      {error.fieldError('images') ?? error.message}
    </Banner>
  );
}
