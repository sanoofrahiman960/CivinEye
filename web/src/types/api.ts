/**
 * Types mirroring the Django REST Framework serializers in the backend apps (serializers.py files).
 * Kept identical to mobile/src/types/api.ts.
 * Keep these in sync with the backend; do not add fields the API does not return.
 */

export type Role = 'CITIZEN' | 'OFFICER' | 'SUPERVISOR' | 'ADMIN';
export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'UNCLASSIFIED';
export type IssueStatus = 'SUBMITTED' | 'ACKNOWLEDGED' | 'IN_PROGRESS' | 'RESOLVED' | 'CLOSED' | 'REOPENED';
export type ClosureType = '' | 'CITIZEN_CONFIRMED' | 'AUTO_TIMEOUT' | 'ADMIN_CLOSED';
export type ImageType = 'REPORT' | 'ADDITIONAL_EVIDENCE' | 'RESOLUTION' | 'REOPEN_EVIDENCE' | 'DURABILITY_EVIDENCE';
export type ProofCheckStatus = 'NOT_APPLICABLE' | 'PASSED' | 'FLAGGED' | 'OVERRIDDEN';
export type CaptureSource = 'CAMERA' | 'GALLERY' | 'UNKNOWN';
export type CommentVisibility = 'CITIZEN_VISIBLE' | 'INTERNAL';

export interface Paginated<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details: Record<string, unknown> };
}

// --- Accounts ---------------------------------------------------------------

export interface DepartmentMini {
  id: number;
  name: string;
}

export type AreaLevel = 'STATE' | 'DISTRICT' | 'TALUK' | 'GRAMA_PANCHAYAT' | 'MUNICIPALITY' | 'CORPORATION' | 'WARD' | 'OTHER';

/** A jurisdiction in the tree State → District → Taluk → Panchayat / Municipality / Corporation → Ward. */
export interface ServiceArea {
  id: number;
  name: string;
  code: string;
  level: AreaLevel;
  level_label: string;
  parent: number | null;
}

/** An area within the signed-in admin's jurisdiction, in tree order (GET /authority/areas/). */
export interface JurisdictionArea extends ServiceArea {
  depth: number;
  path: string;
}

export interface Department extends DepartmentMini {
  code: string;
  description: string;
  contact_email: string;
  service_areas: ServiceArea[];
}

export interface User {
  id: number;
  /** Authority staff log in with this (set by the administrator). Null for citizens. */
  username: string | null;
  full_name: string;
  /** Null for citizens, who sign in with their phone number + OTP. */
  email: string | null;
  phone_number: string;
  role: Role;
  is_authority: boolean;
  /** State/system admin with no area restriction. */
  is_global_admin: boolean;
  department: DepartmentMini | null;
  /** Jurisdiction of authority staff: they only handle issues located inside these areas. */
  service_areas: ServiceArea[];
  preferred_language: string;
  date_joined: string;
}

export interface AuthResponse {
  access: string;
  refresh: string;
  user: User;
}

export interface OtpRequestResponse {
  detail: string;
  /** The number normalised by the backend (E.164, e.g. +919812345678). */
  phone_number: string;
  /** Digits in the code (4 with a development test code, otherwise 6). */
  code_length: number;
  expires_in: number;
  resend_after: number;
}

export type OtpVerifyResponse =
  | { status: 'name_required'; phone_number: string }
  | ({ status: 'authenticated'; is_new_user: boolean } & AuthResponse);

export interface TokenPair {
  access: string;
  refresh: string;
}

// --- Reference data -----------------------------------------------------------

export interface CategoryMini {
  id: number;
  name: string;
  slug: string;
  icon: string;
  is_life_threatening: boolean;
}

export interface Subcategory {
  id: number;
  name: string;
}

export interface Category extends CategoryMini {
  description: string;
  default_priority: Priority;
  default_department: DepartmentMini | null;
  subcategories: Subcategory[];
}

export interface EmergencyContact {
  id: number;
  name: string;
  phone_number: string;
}

export type FeatureKey =
  | 'proof_lock'
  | 'durability_check'
  | 'affects_me_too'
  | 'duplicate_detection'
  | 'offline_queue'
  | 'life_safety';

export interface AppConfiguration {
  features: Record<FeatureKey, { enabled: boolean; config: Record<string, number> }>;
  policies: {
    verification_timeout_days: number;
    auto_close_on_verification_timeout: boolean;
    citizen_reopen_window_days: number;
    max_images_per_upload: number;
    max_image_size_mb: number;
  };
  choices: {
    priorities: { value: Priority; label: string }[];
    statuses: { value: IssueStatus; label: string }[];
    closure_types: { value: ClosureType; label: string }[];
    comment_visibility: { value: CommentVisibility; label: string }[];
  };
}

// --- Issue building blocks -----------------------------------------------------

export interface IssueImage {
  id: number;
  image_type: ImageType;
  image_url: string;
  thumbnail_url: string;
  caption: string;
  uploaded_at: string;
  resolution_cycle: number;
  distance_from_issue_m: number | null;
  proof_check_status: ProofCheckStatus;
}

export interface AuthorityIssueImage extends IssueImage {
  uploaded_by_name: string;
  capture_source: CaptureSource;
  capture_latitude: number | null;
  capture_longitude: number | null;
  capture_accuracy_m: number | null;
  captured_at: string | null;
  proof_check_notes: string;
  override_reason: string;
  overridden_by_name: string | null;
  overridden_at: string | null;
}

export interface HistoryEntry {
  id: number;
  previous_status: IssueStatus | '';
  new_status: IssueStatus;
  reason: string;
  closure_type: ClosureType;
  actor_label: string;
  created_at: string;
}

export interface AuthorityHistoryEntry extends HistoryEntry {
  changed_by: { id: number; full_name: string; role: Role } | null;
  evidence_ids: number[];
}

/** Public timeline entries carry no reasons or actors. */
export interface PublicHistoryEntry {
  id: number;
  new_status: IssueStatus;
  created_at: string;
}

export interface Comment {
  id: number;
  comment: string;
  visibility: CommentVisibility;
  author_name: string;
  author_role: Role;
  is_mine: boolean;
  created_at: string;
}

export interface PriorityChange {
  id: number;
  previous_priority: Priority;
  new_priority: Priority;
  reason: string;
  changed_by_name: string;
  created_at: string;
}

export interface OfficerMini {
  id: number;
  full_name: string;
}

export interface Assignment {
  id: number;
  department: DepartmentMini;
  assigned_officer: OfficerMini | null;
  assigned_by_name: string;
  assigned_at: string;
  notes: string;
  is_current: boolean;
}

// --- Citizen issue views -----------------------------------------------------------

export interface IssueListItem {
  id: number;
  complaint_id: string;
  title: string;
  category: CategoryMini;
  status: IssueStatus;
  priority: Priority;
  address: string;
  latitude: number;
  longitude: number;
  thumbnail_url: string | null;
  impact_count: number;
  is_overdue: boolean;
  created_at: string;
  updated_at: string;
}

/** Full view returned to the reporter of an issue. */
export interface IssueDetail extends IssueListItem {
  description: string;
  additional_details: string;
  subcategory: Subcategory | null;
  reported_urgency: Priority | '';
  department: DepartmentMini | null;
  assigned_officer_name: string | null;
  acknowledged_at: string | null;
  started_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  reopened_at: string | null;
  due_at: string | null;
  closure_type: ClosureType;
  resolution_description: string;
  reopen_count: number;
  satisfaction_rating: number | null;
  satisfaction_comment: string;
  is_recurrence: boolean;
  parent_complaint_id: string | null;
  images: IssueImage[];
  history: HistoryEntry[];
  comments: Comment[];
  is_owner: true;
  can_confirm: boolean;
  can_reopen: boolean;
  can_add_evidence: boolean;
  supported_by_me: boolean;
  durability_check_pending: boolean;
}

/** Limited view for citizens who did not report the issue (approximate location, no private data). */
export interface PublicIssue extends IssueListItem {
  description: string;
  resolved_at: string | null;
  closed_at: string | null;
  closure_type: ClosureType;
  images: IssueImage[];
  history: PublicHistoryEntry[];
  is_owner: false;
  supported_by_me: boolean;
  can_support: boolean;
  durability_check_pending: boolean;
}

export type CitizenIssueView = IssueDetail | PublicIssue;

export interface MapIssue {
  id: number;
  complaint_id: string;
  title: string;
  category: CategoryMini;
  status: IssueStatus;
  priority: Priority;
  latitude: number;
  longitude: number;
  thumbnail_url: string | null;
  impact_count: number;
  is_mine: boolean;
  created_at: string;
}

export interface NearbyIssue extends MapIssue {
  distance_m: number;
  supported_by_me: boolean;
}

export interface DurabilityCheck {
  id: number;
  issue: MapIssue;
  due_at: string;
  sent_at: string | null;
}

export interface IssueSummary {
  counts: { total: number; open: number; in_progress: number; awaiting_verification: number; closed: number };
  recent: IssueListItem[];
  pending_durability_checks: DurabilityCheck[];
}

export interface DurabilityAnswerResult {
  response: 'STILL_FIXED' | 'PROBLEM_RETURNED';
  follow_up_issue: { id: number; complaint_id: string } | null;
}

// --- Authority views -------------------------------------------------------------------

export type AuthorityAction =
  | 'acknowledge'
  | 'start_work'
  | 'resolve'
  | 'reopen'
  | 'assign'
  | 'change_priority'
  | 'close'
  | 'comment';

export interface AuthorityIssueListItem extends IssueListItem {
  description: string;
  reported_urgency: Priority | '';
  recommended_priority: Priority;
  department: DepartmentMini | null;
  assigned_officer: OfficerMini | null;
  service_area_name: string | null;
  days_open: number;
  due_at: string | null;
}

export interface AuthorityIssueDetail extends AuthorityIssueListItem {
  subcategory: Subcategory | null;
  additional_details: string;
  location_accuracy_m: number | null;
  reporter: { id: number; full_name: string; email: string | null; phone_number: string };
  acknowledged_at: string | null;
  started_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  reopened_at: string | null;
  ack_due_at: string | null;
  closure_type: ClosureType;
  resolution_description: string;
  resolution_cycle: number;
  reopen_count: number;
  satisfaction_rating: number | null;
  satisfaction_comment: string;
  is_recurrence: boolean;
  parent_complaint_id: string | null;
  client_reported_at: string | null;
  images: AuthorityIssueImage[];
  history: AuthorityHistoryEntry[];
  comments: Comment[];
  priority_changes: PriorityChange[];
  assignments: Assignment[];
  available_actions: AuthorityAction[];
}

export interface ChartPoint {
  label: string;
  value: number;
}

export interface KeyedChartPoint extends ChartPoint {
  key: string;
}

export interface DurationStats {
  average_hours: number | null;
  median_hours: number | null;
  sample_size: number;
}

export interface Dashboard {
  kpis: {
    total: number;
    awaiting_review: number;
    critical_high: number;
    in_progress: number;
    overdue: number;
    awaiting_verification: number;
    reopened: number;
    closed: number;
  };
  by_category: ChartPoint[];
  by_status: KeyedChartPoint[];
  by_priority: KeyedChartPoint[];
  trend: { period: 'weekly' | 'monthly'; points: { label: string; reported: number; resolved: number }[] };
  resolution_time: DurationStats;
  acknowledgement_time: DurationStats;
  generated_at: string;
}

export interface DepartmentReportRow {
  department_id: number | null;
  department: string;
  total: number;
  open: number;
  resolved: number;
  overdue: number;
  reopen_rate: number | null;
  average_resolution_hours: number | null;
}

export interface ReportSummary {
  departments: DepartmentReportRow[];
  total: number;
}

// --- Notifications -----------------------------------------------------------------------

export type NotificationType =
  | 'ISSUE_SUBMITTED'
  | 'NEW_ISSUE'
  | 'LIFE_SAFETY_ALERT'
  | 'ISSUE_ACKNOWLEDGED'
  | 'ISSUE_ASSIGNED'
  | 'WORK_STARTED'
  | 'VERIFICATION_REQUESTED'
  | 'ISSUE_REOPENED'
  | 'ISSUE_CLOSED'
  | 'SLA_BREACH'
  | 'PRIORITY_CHANGED'
  | 'NEW_COMMENT'
  | 'DURABILITY_CHECK'
  | 'RECURRENCE_REPORTED';

/** A staff account an admin manages (GET /authority/team/). */
export interface TeamMember {
  id: number;
  username: string | null;
  full_name: string;
  email: string | null;
  phone_number: string;
  role: 'OFFICER' | 'SUPERVISOR' | 'ADMIN';
  department: DepartmentMini | null;
  service_areas: JurisdictionArea[];
  is_global_admin: boolean;
  is_active: boolean;
  last_login: string | null;
  date_joined: string;
}

export interface TeamMemberInput {
  username: string;
  full_name: string;
  email?: string | null;
  phone_number?: string;
  role: TeamMember['role'];
  department_id?: number | null;
  service_area_ids: number[];
  is_active?: boolean;
  /** Required when creating; passwords are changed later with resetPassword. */
  password?: string;
}

export interface AppNotification {
  id: number;
  issue: number | null;
  complaint_id: string | null;
  title: string;
  message: string;
  notification_type: NotificationType;
  is_read: boolean;
  created_at: string;
}
