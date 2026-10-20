from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from apps.audit.models import log_action
from apps.core.exceptions import BusinessRuleViolation, FeatureDisabled
from apps.core.geo import haversine_m
from apps.core.models import get_flag
from apps.issues.models import RANKED_PRIORITIES, PRIORITY_RANK, ClosureType, ImageType, Issue, Priority, Status
from apps.notifications.models import NotificationType
from apps.notifications.services import notify, notify_authority

from .models import DurabilityCheck, DurabilityResponse, IssueSupport


def _require_flag(key):
    flag = get_flag(key)
    if not flag:
        raise FeatureDisabled()
    return flag


# ---------------------------------------------------------------------------
# "Affects me too"
# ---------------------------------------------------------------------------

def add_support(issue, user, latitude, longitude, note=""):
    from apps.issues.services import recommend_priority

    flag = _require_flag("affects_me_too")
    if issue.reporter_id == user.pk:
        raise BusinessRuleViolation("You reported this issue, so it already counts you.", code="own_issue")
    if issue.status == Status.CLOSED:
        raise BusinessRuleViolation("This issue is closed. Report a new issue if the problem is back.", code="issue_closed")
    max_distance = float(flag.get("max_distance_m", 2000))
    if haversine_m(latitude, longitude, issue.latitude, issue.longitude) > max_distance:
        raise BusinessRuleViolation(
            f"You need to be within {max_distance / 1000:g} km of this issue to say it affects you.", code="too_far"
        )
    try:
        with transaction.atomic():
            support = IssueSupport.objects.create(
                issue=issue, user=user, latitude=latitude, longitude=longitude, note=(note or "").strip()[:500]
            )
    except IntegrityError:
        raise BusinessRuleViolation("You have already said this issue affects you.", code="already_supported")

    Issue.objects.filter(pk=issue.pk).update(impact_count=F("impact_count") + 1)
    issue.refresh_from_db()
    recommended = recommend_priority(issue.category, issue.reported_urgency, issue.impact_count)
    if PRIORITY_RANK[recommended] > PRIORITY_RANK[issue.recommended_priority]:
        issue.recommended_priority = recommended
        issue.save(update_fields=["recommended_priority", "updated_at"])
    log_action(user, "issue.supported", issue, {"impact_count": issue.impact_count})
    return support


def remove_support(issue, user):
    deleted, _ = IssueSupport.objects.filter(issue=issue, user=user).delete()
    if not deleted:
        raise BusinessRuleViolation("You have not supported this issue.", code="not_supported")
    Issue.objects.filter(pk=issue.pk, impact_count__gt=0).update(impact_count=F("impact_count") - 1)
    issue.refresh_from_db()
    log_action(user, "issue.support_removed", issue, {"impact_count": issue.impact_count})
    return issue


# ---------------------------------------------------------------------------
# Fix durability checks
# ---------------------------------------------------------------------------

def schedule_durability_checks(issue):
    """Create 'is it still fixed?' checks for the reporter and supporters when an issue closes."""
    if not get_flag("durability_check") or issue.closure_type == ClosureType.ADMIN_CLOSED:
        return []
    days = issue.category.durability_check_days
    if not days:
        return []
    due_at = (issue.closed_at or timezone.now()) + timedelta(days=days)
    recipients = {issue.reporter_id, *IssueSupport.objects.filter(issue=issue).values_list("user_id", flat=True)}
    checks = []
    for user_id in recipients:
        check, created = DurabilityCheck.objects.get_or_create(
            issue=issue, recipient_id=user_id, defaults={"due_at": due_at}
        )
        if not created and check.response == DurabilityResponse.CANCELLED:
            check.response = DurabilityResponse.PENDING
            check.due_at = due_at
            check.sent_at = None
            check.save(update_fields=["response", "due_at", "sent_at"])
        checks.append(check)
    return checks


def send_due_durability_checks(now=None):
    if not get_flag("durability_check"):
        return 0
    now = now or timezone.now()
    due = DurabilityCheck.objects.filter(
        response=DurabilityResponse.PENDING, sent_at__isnull=True, due_at__lte=now, issue__status=Status.CLOSED
    ).select_related("issue", "recipient")
    sent = 0
    for check in due:
        notify(
            check.recipient,
            NotificationType.DURABILITY_CHECK,
            "Is it still fixed?",
            f"{check.issue.complaint_id} ({check.issue.title}) was fixed a while ago. Is it still OK?",
            issue=check.issue,
            dedupe_key=f"durability:{check.pk}",
        )
        check.sent_at = now
        check.save(update_fields=["sent_at"])
        sent += 1
    return sent


def expire_durability_checks(now=None):
    now = now or timezone.now()
    window = get_flag("durability_check").get("response_window_days", 14)
    return DurabilityCheck.objects.filter(
        response=DurabilityResponse.PENDING, sent_at__lt=now - timedelta(days=window)
    ).update(response=DurabilityResponse.NO_RESPONSE)


def pending_checks_for(user):
    return DurabilityCheck.objects.filter(
        recipient=user, response=DurabilityResponse.PENDING, sent_at__isnull=False
    ).select_related("issue", "issue__category")


def respond_to_durability_check(issue, user, response, note="", files=(), latitude=None, longitude=None):
    """Record the answer. 'Problem returned' opens a new linked recurrence issue instead of reopening."""
    from apps.issues.services import create_issue

    _require_flag("durability_check")
    check = DurabilityCheck.objects.select_for_update().filter(issue=issue, recipient=user).first()
    if check is None:
        raise PermissionDenied("There is no follow-up question for you on this issue.")
    if check.response != DurabilityResponse.PENDING or check.sent_at is None:
        raise BusinessRuleViolation("This follow-up has already been answered or has expired.", code="check_closed")
    if response not in (DurabilityResponse.STILL_FIXED, DurabilityResponse.PROBLEM_RETURNED):
        raise ValidationError({"response": ["Choose 'Still fixed' or 'Problem returned'."]})

    check.response = response
    check.responded_at = timezone.now()
    check.note = (note or "").strip()[:500]

    if response == DurabilityResponse.PROBLEM_RETURNED:
        if not files:
            raise ValidationError({"images": ["Add a photo showing the problem has returned."]})
        existing = (
            Issue.objects.filter(parent_issue=issue, is_recurrence=True).exclude(status=Status.CLOSED).first()
        )
        if existing is not None:
            # Someone already reported the recurrence: count this person as affected instead of duplicating it.
            if existing.reporter_id != user.pk:
                IssueSupport.objects.get_or_create(
                    issue=existing,
                    user=user,
                    defaults={"latitude": existing.latitude, "longitude": existing.longitude, "note": check.note},
                )
                Issue.objects.filter(pk=existing.pk).update(
                    impact_count=IssueSupport.objects.filter(issue=existing).count()
                )
            check.follow_up_issue = existing
        else:
            rank = PRIORITY_RANK.get(issue.priority, 0)
            bumped = RANKED_PRIORITIES[min(max(rank, 1), len(RANKED_PRIORITIES) - 1)] if rank else Priority.MEDIUM
            follow_up, _ = create_issue(
                user,
                {
                    "title": f"Recurring: {issue.title}"[:150],
                    "description": check.note or f"The problem reported in {issue.complaint_id} has returned.",
                    "category": issue.category,
                    "subcategory": issue.subcategory,
                    "latitude": issue.latitude,
                    "longitude": issue.longitude,
                    "address": issue.address,
                    "parent_issue": issue,
                    "recommended_priority": bumped,
                },
                list(files),
            )
            check.follow_up_issue = follow_up
            notify_authority(
                follow_up,
                NotificationType.RECURRENCE_REPORTED,
                "Problem returned after a fix",
                f"{follow_up.complaint_id} reports that {issue.complaint_id} is broken again.",
                event_key=f"recurrence:{follow_up.pk}",
            )
    check.save()
    log_action(user, "issue.durability_response", issue, {"response": response, "follow_up": check.follow_up_issue_id})
    return check
