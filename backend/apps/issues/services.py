"""Issue business rules.

All status changes go through `_transition`, which enforces the lifecycle, stamps timestamps, writes
an IssueHistory row and an audit entry. Views call the action functions below and never set
`Issue.status` directly.

Lifecycle:
    SUBMITTED → ACKNOWLEDGED → IN_PROGRESS → RESOLVED (awaiting citizen verification) → CLOSED
    RESOLVED / CLOSED → REOPENED → ACKNOWLEDGED or IN_PROGRESS
    any non-closed status → CLOSED only through an administrator closure
"""
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.assignments.models import IssueAssignment
from apps.audit.models import log_action
from apps.core.exceptions import BusinessRuleViolation, InvalidTransition
from apps.core.geo import haversine_m
from apps.core.images import hamming_distance, process_upload, validate_image_count
from apps.core.models import PlatformConfiguration, get_flag
from apps.departments.models import ServiceArea
from apps.notifications.models import NotificationType
from apps.notifications.services import notify, notify_authority, notify_followers

from .models import (
    PRIORITY_RANK,
    RANKED_PRIORITIES,
    CaptureSource,
    ClosureType,
    CommentVisibility,
    ImageType,
    Issue,
    IssueComment,
    IssueHistory,
    IssueImage,
    IssuePriorityChange,
    Priority,
    ProofCheckStatus,
    Status,
)
from .selectors import overdue_q

STATUS_TRANSITIONS = {
    Status.SUBMITTED: {Status.ACKNOWLEDGED, Status.CLOSED},
    Status.ACKNOWLEDGED: {Status.IN_PROGRESS, Status.CLOSED},
    Status.IN_PROGRESS: {Status.RESOLVED, Status.CLOSED},
    Status.RESOLVED: {Status.CLOSED, Status.REOPENED},
    Status.CLOSED: {Status.REOPENED},
    Status.REOPENED: {Status.ACKNOWLEDGED, Status.IN_PROGRESS, Status.CLOSED},
}

ACCEPTED_PROOF = (ProofCheckStatus.PASSED, ProofCheckStatus.OVERRIDDEN, ProofCheckStatus.NOT_APPLICABLE)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _lock(issue):
    """Re-read the issue with a row lock so concurrent actions cannot both transition it."""
    return Issue.objects.select_for_update().select_related("category", "department", "reporter").get(pk=issue.pk)


def _require_text(value, field, message):
    value = (value or "").strip()
    if not value:
        raise ValidationError({field: [message]})
    return value


def _status_label(status):
    return Status(status).label


def recommend_priority(category, reported_urgency="", impact_count=0):
    """Rule-based priority recommendation. Officers review it and set the official priority."""
    if category.is_life_threatening:
        return Priority.CRITICAL
    base = category.default_priority
    if base == Priority.UNCLASSIFIED:
        return Priority.UNCLASSIFIED
    rank = PRIORITY_RANK[base]
    high = PRIORITY_RANK[Priority.HIGH]
    # Citizen urgency and the number of affected people can each raise the level by one, never above High.
    if reported_urgency and PRIORITY_RANK.get(reported_urgency, 0) > rank and rank < high:
        rank += 1
    threshold = get_flag("affects_me_too").get("impact_bump_threshold", 10)
    if impact_count >= threshold and rank < high:
        rank += 1
    return RANKED_PRIORITIES[rank - 1]


def compute_sla(issue, base=None):
    config = PlatformConfiguration.load()
    base = base or issue.reopened_at or issue.created_at
    category = issue.category
    resolve_hours = category.sla_resolve_hours
    priority_hours = (config.priority_sla_hours or {}).get(issue.priority)
    if priority_hours:
        resolve_hours = min(resolve_hours, int(priority_hours))
    ack_hours = category.sla_ack_hours
    if category.is_life_threatening:
        life_safety = get_flag("life_safety")
        if life_safety:
            ack_hours = min(ack_hours, int(life_safety.get("ack_sla_hours", 1)))
    issue.ack_due_at = base + timedelta(hours=ack_hours)
    issue.due_at = base + timedelta(hours=resolve_hours)


def _transition(issue, new_status, actor, reason="", closure_type="", evidence=()):
    if new_status not in STATUS_TRANSITIONS.get(issue.status, set()):
        raise InvalidTransition(
            f"An issue that is '{_status_label(issue.status)}' cannot be moved to '{_status_label(new_status)}'."
        )
    now = timezone.now()
    previous = issue.status
    issue.status = new_status
    if new_status == Status.ACKNOWLEDGED:
        issue.acknowledged_at = now
    elif new_status == Status.IN_PROGRESS:
        issue.started_at = now
    elif new_status == Status.RESOLVED:
        issue.resolved_at = now
    elif new_status == Status.CLOSED:
        issue.closed_at = now
        issue.closure_type = closure_type
    elif new_status == Status.REOPENED:
        issue.reopened_at = now
        issue.reopen_count += 1
        issue.resolution_cycle += 1
        issue.closure_type = ""
        issue.closed_at = None
        compute_sla(issue, base=now)
    issue.is_overdue = issue.compute_overdue(now)
    issue.save()

    entry = IssueHistory.objects.create(
        issue=issue,
        previous_status=previous,
        new_status=new_status,
        changed_by=actor,
        reason=reason,
        closure_type=closure_type,
    )
    if evidence:
        entry.evidence.set(evidence)
    log_action(
        actor,
        f"issue.status.{new_status.lower()}",
        issue,
        {"from": previous, "to": new_status, "closure_type": closure_type, "system": actor is None},
    )
    return entry


def _save_images(issue, user, processed_images, image_type, caption="", **extra):
    images = []
    for processed in processed_images:
        images.append(
            IssueImage.objects.create(
                issue=issue,
                image=processed.image,
                thumbnail=processed.thumbnail,
                perceptual_hash=processed.perceptual_hash,
                image_type=image_type,
                uploaded_by=user,
                caption=caption,
                resolution_cycle=issue.resolution_cycle,
                **extra,
            )
        )
    return images


def _process_files(files, required=False):
    config = PlatformConfiguration.load()
    validate_image_count(files, config.max_images_per_upload, required=required)
    return [process_upload(f) for f in files]


# ---------------------------------------------------------------------------
# Citizen actions
# ---------------------------------------------------------------------------

def create_issue(reporter, data, files):
    """Create a complaint. Returns (issue, created). Re-sending a client_submission_id returns the original."""
    submission_id = data.get("client_submission_id")
    if submission_id:
        existing = Issue.objects.filter(reporter=reporter, client_submission_id=submission_id).first()
        if existing:
            return existing, False

    now = timezone.now()
    client_reported_at = data.get("client_reported_at")
    if client_reported_at:
        max_age = get_flag("offline_queue").get("max_age_hours", 72)
        if client_reported_at > now + timedelta(minutes=5):
            raise ValidationError({"client_reported_at": ["The capture time cannot be in the future."]})
        if client_reported_at < now - timedelta(hours=max_age):
            raise ValidationError(
                {"client_reported_at": [f"Offline reports must be sent within {max_age} hours of capture."]}
            )

    processed = _process_files(files, required=True)
    config = PlatformConfiguration.load()
    category = data["category"]
    urgency = data.get("reported_urgency") or ""

    issue = Issue(
        reporter=reporter,
        title=data["title"].strip(),
        description=data["description"].strip(),
        additional_details=(data.get("additional_details") or "").strip(),
        category=category,
        subcategory=data.get("subcategory"),
        latitude=data["latitude"],
        longitude=data["longitude"],
        location_accuracy_m=data.get("location_accuracy_m"),
        address=(data.get("address") or "").strip(),
        reported_urgency=urgency,
        client_submission_id=submission_id,
        client_reported_at=client_reported_at,
        created_at=now,
        department=category.default_department,
        service_area=ServiceArea.locate(data["latitude"], data["longitude"]),
        parent_issue=data.get("parent_issue"),
        is_recurrence=bool(data.get("parent_issue")),
    )
    issue.recommended_priority = data.get("recommended_priority") or recommend_priority(category, urgency)
    if config.auto_apply_priority_rules or category.is_life_threatening:
        issue.priority = issue.recommended_priority
    compute_sla(issue, base=now)

    try:
        with transaction.atomic():
            issue.save()
    except IntegrityError:
        if submission_id:
            existing = Issue.objects.filter(reporter=reporter, client_submission_id=submission_id).first()
            if existing:
                return existing, False
        raise

    issue.complaint_id = f"CE-{timezone.localtime(now):%Y}-{issue.pk:06d}"
    issue.save(update_fields=["complaint_id"])

    images = _save_images(issue, reporter, processed, ImageType.REPORT)
    if issue.department_id:
        IssueAssignment.objects.create(
            issue=issue, department=issue.department, notes="Routed automatically based on the issue category."
        )
    entry = IssueHistory.objects.create(
        issue=issue, previous_status="", new_status=Status.SUBMITTED, changed_by=reporter, reason="Complaint submitted."
    )
    entry.evidence.set(images)
    log_action(reporter, "issue.created", issue, {"category": category.slug, "priority": issue.priority})

    notify(
        reporter,
        NotificationType.ISSUE_SUBMITTED,
        "Complaint submitted",
        f"Your complaint {issue.complaint_id} has been received. We'll keep you updated.",
        issue=issue,
        dedupe_key=f"submitted:{issue.pk}",
    )
    life_safety = category.is_life_threatening and bool(get_flag("life_safety"))
    notify_authority(
        issue,
        NotificationType.LIFE_SAFETY_ALERT if life_safety else NotificationType.NEW_ISSUE,
        f"{'URGENT: ' if life_safety else ''}New {category.name} report",
        f"{issue.complaint_id}: {issue.title}",
        event_key=f"new:{issue.pk}",
        high_priority=life_safety,
    )
    return issue, True


def add_additional_evidence(issue, citizen, files, caption=""):
    issue = _lock(issue)
    if issue.reporter_id != citizen.pk:
        raise PermissionDenied("You can only add evidence to your own complaints.")
    if issue.status == Status.CLOSED:
        raise BusinessRuleViolation("This complaint is closed. Reopen it to add new evidence.", code="issue_closed")
    processed = _process_files(files, required=True)
    images = _save_images(issue, citizen, processed, ImageType.ADDITIONAL_EVIDENCE, caption=(caption or "").strip()[:255])
    issue.save(update_fields=["updated_at"])
    log_action(citizen, "issue.evidence_added", issue, {"images": [i.pk for i in images]})
    notify_authority(
        issue,
        NotificationType.NEW_COMMENT,
        "Reporter added evidence",
        f"New photos were added to {issue.complaint_id}.",
        event_key=f"evidence:{images[0].pk}",
    )
    return images


def confirm_resolution(issue, citizen, rating=None, comment=""):
    issue = _lock(issue)
    if issue.reporter_id != citizen.pk:
        raise PermissionDenied("Only the reporter can confirm this resolution.")
    if issue.status != Status.RESOLVED:
        raise InvalidTransition("Only issues awaiting your verification can be confirmed.")
    issue.satisfaction_rating = rating
    issue.satisfaction_comment = (comment or "").strip()
    entry = _transition(
        issue,
        Status.CLOSED,
        citizen,
        reason="The reporter confirmed the issue is fixed.",
        closure_type=ClosureType.CITIZEN_CONFIRMED,
    )
    from apps.community.services import schedule_durability_checks

    schedule_durability_checks(issue)
    _notify_closed(issue, entry, exclude=citizen)
    notify_authority(
        issue,
        NotificationType.ISSUE_CLOSED,
        "Resolution confirmed",
        f"The reporter confirmed {issue.complaint_id} is fixed.",
        event_key=f"history:{entry.pk}",
    )
    return issue


def citizen_reopen(issue, citizen, reason, files=()):
    issue = _lock(issue)
    if issue.reporter_id != citizen.pk:
        raise PermissionDenied("You can only reopen your own complaints.")
    reason = _require_text(reason, "reason", "Tell us why the issue is not fixed.")
    if not can_citizen_reopen(issue):
        raise InvalidTransition("This complaint can no longer be reopened. Please submit a new report.")
    processed = _process_files(list(files))
    entry = _transition(issue, Status.REOPENED, citizen, reason=reason)
    images = _save_images(issue, citizen, processed, ImageType.REOPEN_EVIDENCE)
    if images:
        entry.evidence.set(images)
    _after_reopen(issue, entry, citizen)
    return issue


def can_citizen_reopen(issue):
    if issue.status == Status.RESOLVED:
        return True
    if issue.status == Status.CLOSED and issue.closure_type != ClosureType.ADMIN_CLOSED and issue.closed_at:
        window = PlatformConfiguration.load().citizen_reopen_window_days
        return timezone.now() <= issue.closed_at + timedelta(days=window)
    return False


def add_comment(issue, author, text, visibility=CommentVisibility.CITIZEN_VISIBLE):
    text = _require_text(text, "comment", "Write a comment.")
    if author.is_citizen:
        if issue.reporter_id != author.pk:
            raise PermissionDenied("You can only comment on your own complaints.")
        visibility = CommentVisibility.CITIZEN_VISIBLE
    comment = IssueComment.objects.create(issue=issue, author=author, comment=text, visibility=visibility)
    Issue.objects.filter(pk=issue.pk).update(updated_at=timezone.now())
    log_action(author, "issue.comment_added", issue, {"comment": comment.pk, "visibility": visibility})
    if author.is_citizen:
        notify_authority(
            issue,
            NotificationType.NEW_COMMENT,
            "New comment from reporter",
            f"{issue.complaint_id}: {text[:120]}",
            event_key=f"comment:{comment.pk}",
        )
    elif visibility == CommentVisibility.CITIZEN_VISIBLE:
        notify_followers(
            issue,
            NotificationType.NEW_COMMENT,
            f"Update on {issue.complaint_id}",
            text[:200],
            event_key=f"comment:{comment.pk}",
        )
    return comment


# ---------------------------------------------------------------------------
# Authority actions
# ---------------------------------------------------------------------------

def acknowledge(issue, actor, comment=""):
    issue = _lock(issue)
    entry = _transition(issue, Status.ACKNOWLEDGED, actor, reason=(comment or "").strip() or "Issue acknowledged by the department.")
    notify_followers(
        issue,
        NotificationType.ISSUE_ACKNOWLEDGED,
        "Complaint acknowledged",
        f"{issue.complaint_id} has been reviewed by {issue.department or 'the authority'}.",
        event_key=f"history:{entry.pk}",
    )
    return issue


def start_work(issue, actor, comment=""):
    issue = _lock(issue)
    entry = _transition(issue, Status.IN_PROGRESS, actor, reason=(comment or "").strip() or "Work has started.")
    notify_followers(
        issue,
        NotificationType.WORK_STARTED,
        "Work started",
        f"Work has started on {issue.complaint_id}.",
        event_key=f"history:{entry.pk}",
    )
    return issue


def _evaluate_proof(issue, image, flag):
    notes = []
    if image.capture_latitude is None or image.capture_longitude is None:
        notes.append("No GPS position was recorded with the photo.")
    else:
        distance = haversine_m(issue.latitude, issue.longitude, image.capture_latitude, image.capture_longitude)
        image.distance_from_issue_m = round(distance, 1)
        max_distance = float(flag.get("max_distance_m", 50))
        if distance > max_distance:
            notes.append(f"Photo taken {distance:.0f} m from the reported location (limit {max_distance:.0f} m).")
        max_accuracy = float(flag.get("max_accuracy_m", 30))
        if image.capture_accuracy_m is not None and image.capture_accuracy_m > max_accuracy:
            notes.append(f"GPS accuracy was {image.capture_accuracy_m:.0f} m (limit {max_accuracy:.0f} m).")

    threshold = int(flag.get("hash_threshold", 5))
    earlier = (
        IssueImage.objects.exclude(perceptual_hash="")
        .exclude(issue=issue, image_type=ImageType.RESOLUTION, resolution_cycle=issue.resolution_cycle)
        .values_list("perceptual_hash", "issue__complaint_id", "image_type")
    )
    for other_hash, complaint_id, image_type in earlier.iterator():
        if hamming_distance(image.perceptual_hash, other_hash) <= threshold:
            source = "this complaint's own report photo" if complaint_id == issue.complaint_id else f"an image on {complaint_id}"
            notes.append(f"Photo closely matches {source} ({ImageType(image_type).label.lower()}).")
            break

    image.proof_check_status = ProofCheckStatus.FLAGGED if notes else ProofCheckStatus.PASSED
    image.proof_check_notes = " ".join(notes)[:255]


def resolve(issue, actor, description, files, capture):
    """Submit resolution evidence and move to RESOLVED.

    Returns (resolved, new_images). When Proof-Lock flags every resolution photo of the current
    cycle, the photos are kept, the issue stays IN_PROGRESS and `resolved` is False; a supervisor
    can then override the flag and the officer resolves again without re-uploading.
    """
    issue = _lock(issue)
    if issue.status != Status.IN_PROGRESS:
        raise InvalidTransition("Mark the issue as In Progress before submitting the resolution.")
    description = _require_text(description, "resolution_description", "Describe the work that was done.")

    flag = get_flag("proof_lock")
    department = issue.department
    source = capture.get("capture_source") or CaptureSource.UNKNOWN
    gallery_allowed = bool(department and department.allow_gallery_resolution)
    if flag and files and source != CaptureSource.CAMERA and not gallery_allowed:
        raise BusinessRuleViolation(
            "Resolution photos must be taken with the in-app camera at the issue location.", code="camera_required"
        )

    processed = _process_files(list(files))
    new_images = []
    for item in processed:
        image = IssueImage(
            issue=issue,
            image=item.image,
            thumbnail=item.thumbnail,
            perceptual_hash=item.perceptual_hash,
            image_type=ImageType.RESOLUTION,
            uploaded_by=actor,
            resolution_cycle=issue.resolution_cycle,
            capture_source=source,
            capture_latitude=capture.get("capture_latitude"),
            capture_longitude=capture.get("capture_longitude"),
            capture_accuracy_m=capture.get("capture_accuracy_m"),
            captured_at=capture.get("captured_at"),
        )
        if flag:
            _evaluate_proof(issue, image, flag)
        elif image.capture_latitude is not None and image.capture_longitude is not None:
            image.distance_from_issue_m = round(
                haversine_m(issue.latitude, issue.longitude, image.capture_latitude, image.capture_longitude), 1
            )
        image.save()
        new_images.append(image)

    cycle_images = issue.images.filter(image_type=ImageType.RESOLUTION, resolution_cycle=issue.resolution_cycle)
    if not cycle_images.exists() and not (department and department.allow_resolution_without_evidence):
        raise BusinessRuleViolation(
            "A photograph of the resolved condition is required.", code="resolution_evidence_required"
        )
    accepted = list(cycle_images.filter(proof_check_status__in=ACCEPTED_PROOF))
    if cycle_images.exists() and not accepted:
        log_action(actor, "issue.proof_check_flagged", issue, {"images": [i.pk for i in new_images]})
        return False, new_images

    issue.resolution_description = description
    entry = _transition(issue, Status.RESOLVED, actor, reason=description, evidence=accepted)
    notify_followers(
        issue,
        NotificationType.VERIFICATION_REQUESTED,
        "Is it fixed? Please verify",
        f"The authority marked {issue.complaint_id} as resolved. Check the photos and confirm or reopen.",
        event_key=f"history:{entry.pk}",
    )
    return True, new_images


def override_proof_check(image, actor, reason):
    reason = _require_text(reason, "reason", "Explain why this photo should be accepted.")
    if image.proof_check_status != ProofCheckStatus.FLAGGED:
        raise BusinessRuleViolation("Only flagged photos can be overridden.", code="not_flagged")
    image.proof_check_status = ProofCheckStatus.OVERRIDDEN
    image.override_reason = reason
    image.overridden_by = actor
    image.overridden_at = timezone.now()
    image.save(update_fields=["proof_check_status", "override_reason", "overridden_by", "overridden_at"])
    log_action(actor, "issue.proof_check_overridden", image.issue, {"image": image.pk, "reason": reason})
    return image


def authority_reopen(issue, actor, reason):
    issue = _lock(issue)
    reason = _require_text(reason, "reason", "Explain what follow-up work is needed.")
    if issue.status not in (Status.RESOLVED, Status.CLOSED):
        raise InvalidTransition("Only resolved or closed issues can be reopened.")
    entry = _transition(issue, Status.REOPENED, actor, reason=reason)
    _after_reopen(issue, entry, actor)
    return issue


def _after_reopen(issue, entry, actor):
    from apps.community.models import DurabilityCheck, DurabilityResponse

    DurabilityCheck.objects.filter(issue=issue, response=DurabilityResponse.PENDING).update(
        response=DurabilityResponse.CANCELLED
    )
    notify_authority(
        issue,
        NotificationType.ISSUE_REOPENED,
        "Issue reopened",
        f"{issue.complaint_id} was reopened: {entry.reason[:150]}",
        event_key=f"history:{entry.pk}",
        exclude=actor,
    )
    notify_followers(
        issue,
        NotificationType.ISSUE_REOPENED,
        "Complaint reopened",
        f"{issue.complaint_id} has been reopened and returned to the department's queue.",
        event_key=f"history:{entry.pk}",
        exclude=actor,
    )


def admin_close(issue, actor, reason):
    if not actor.is_platform_admin:
        raise PermissionDenied("Only administrators can close an issue directly.")
    issue = _lock(issue)
    reason = _require_text(reason, "reason", "A reason is required to close this issue.")
    if issue.status == Status.CLOSED:
        raise InvalidTransition("This issue is already closed.")
    entry = _transition(issue, Status.CLOSED, actor, reason=reason, closure_type=ClosureType.ADMIN_CLOSED)
    _notify_closed(issue, entry)
    return issue


def _notify_closed(issue, entry, exclude=None):
    messages = {
        ClosureType.CITIZEN_CONFIRMED: "Thank you for confirming. This complaint is now closed.",
        ClosureType.AUTO_TIMEOUT: "This complaint was closed automatically because it was not verified in time. "
        "You can still reopen it for a limited period.",
        ClosureType.ADMIN_CLOSED: f"This complaint was closed by an administrator: {entry.reason[:150]}",
    }
    notify_followers(
        issue,
        NotificationType.ISSUE_CLOSED,
        f"{issue.complaint_id} closed",
        messages.get(issue.closure_type, "This complaint is now closed."),
        event_key=f"history:{entry.pk}",
        exclude=exclude,
    )


def change_priority(issue, actor, new_priority, reason):
    issue = _lock(issue)
    reason = _require_text(reason, "reason", "A reason is required to change the priority.")
    if issue.status == Status.CLOSED:
        raise BusinessRuleViolation("The priority of a closed issue cannot be changed.", code="issue_closed")
    if new_priority == issue.priority:
        raise BusinessRuleViolation("The issue already has this priority.", code="no_change")
    change = IssuePriorityChange.objects.create(
        issue=issue, previous_priority=issue.priority, new_priority=new_priority, changed_by=actor, reason=reason
    )
    issue.priority = new_priority
    compute_sla(issue)
    issue.is_overdue = issue.compute_overdue()
    issue.save()
    log_action(actor, "issue.priority_changed", issue, {"from": change.previous_priority, "to": new_priority, "reason": reason})
    notify_followers(
        issue,
        NotificationType.PRIORITY_CHANGED,
        "Priority updated",
        f"{issue.complaint_id} is now {Priority(new_priority).label} priority.",
        event_key=f"priority:{change.pk}",
    )
    return issue


def assign(issue, actor, department, officer=None, notes=""):
    issue = _lock(issue)
    if issue.status == Status.CLOSED:
        raise BusinessRuleViolation("Closed issues cannot be reassigned. Reopen the issue first.", code="issue_closed")
    if department.pk != issue.department_id and not actor.is_supervisor_or_admin:
        raise PermissionDenied("Only supervisors or administrators can move an issue to another department.")
    if officer is not None:
        if not officer.is_active or officer.role not in ("OFFICER", "SUPERVISOR"):
            raise ValidationError({"officer_id": ["This user cannot be assigned issues."]})
        if officer.department_id != department.pk:
            raise ValidationError({"officer_id": ["The officer must belong to the selected department."]})
        from apps.departments.jurisdiction import covers_area

        if issue.service_area_id and not covers_area(officer, issue.service_area_id):
            raise ValidationError({"officer_id": ["This officer does not cover the area where the issue is located."]})

    department_changed = department.pk != issue.department_id
    IssueAssignment.objects.filter(issue=issue, is_current=True).update(is_current=False)
    assignment = IssueAssignment.objects.create(
        issue=issue, department=department, assigned_officer=officer, assigned_by=actor, notes=(notes or "").strip()
    )
    issue.department = department
    issue.assigned_officer = officer
    issue.save()
    log_action(
        actor,
        "issue.assigned",
        issue,
        {"department": department.pk, "officer": officer.pk if officer else None, "assignment": assignment.pk},
    )

    notify_followers(
        issue,
        NotificationType.ISSUE_ASSIGNED,
        "Department assigned",
        f"{issue.complaint_id} is being handled by {department.name}.",
        event_key=f"assignment:{assignment.pk}",
    )
    if officer is not None and officer.pk != actor.pk:
        notify(
            officer,
            NotificationType.ISSUE_ASSIGNED,
            "Issue assigned to you",
            f"{issue.complaint_id}: {issue.title}",
            issue=issue,
            dedupe_key=f"assignment:{assignment.pk}",
        )
    elif officer is None and department_changed:
        notify_authority(
            issue,
            NotificationType.ISSUE_ASSIGNED,
            "Issue transferred to your department",
            f"{issue.complaint_id}: {issue.title}",
            event_key=f"assignment:{assignment.pk}",
            exclude=actor,
        )
    return issue


# ---------------------------------------------------------------------------
# Scheduled jobs
# ---------------------------------------------------------------------------

def mark_overdue(now=None):
    """Flag issues that have breached their SLA (alerting staff once per breach) and clear stale flags."""
    now = now or timezone.now()
    newly_overdue = Issue.objects.filter(overdue_q(now), is_overdue=False).select_related("department", "assigned_officer")
    count = 0
    for issue in newly_overdue:
        issue.is_overdue = True
        issue.save(update_fields=["is_overdue"])
        kind = "resolution" if issue.due_at and now > issue.due_at else "acknowledgement"
        notify_authority(
            issue,
            NotificationType.SLA_BREACH,
            "SLA breached",
            f"{issue.complaint_id} has passed its {kind} deadline.",
            event_key=f"sla:{issue.pk}:{issue.resolution_cycle}:{kind}",
            high_priority=True,
        )
        log_action(None, "issue.sla_breached", issue, {"kind": kind})
        count += 1
    cleared = Issue.objects.filter(is_overdue=True).exclude(overdue_q(now)).update(is_overdue=False)
    return {"newly_overdue": count, "cleared": cleared}


def auto_close_expired_verifications(now=None):
    """Apply the verification-timeout policy. Recorded as AUTO_TIMEOUT, never as citizen-confirmed."""
    config = PlatformConfiguration.load()
    if not config.auto_close_on_verification_timeout:
        return 0
    now = now or timezone.now()
    cutoff = now - timedelta(days=config.verification_timeout_days)
    from apps.community.services import schedule_durability_checks

    closed = 0
    for issue_id in Issue.objects.filter(status=Status.RESOLVED, resolved_at__lt=cutoff).values_list("pk", flat=True):
        with transaction.atomic():
            issue = _lock(Issue(pk=issue_id))
            if issue.status != Status.RESOLVED:
                continue
            entry = _transition(
                issue,
                Status.CLOSED,
                None,
                reason=(
                    f"Closed automatically: the reporter did not respond within "
                    f"{config.verification_timeout_days} days. This was not confirmed by the reporter."
                ),
                closure_type=ClosureType.AUTO_TIMEOUT,
            )
            schedule_durability_checks(issue)
            _notify_closed(issue, entry)
            closed += 1
    return closed
