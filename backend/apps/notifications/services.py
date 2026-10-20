from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction

from .models import Notification

User = get_user_model()


def notify(recipient, notification_type, title, message, issue=None, dedupe_key=None, high_priority=False):
    """Create an in-app notification (once per dedupe key) and queue a push message after commit."""
    if recipient is None or not recipient.is_active:
        return None
    if dedupe_key:
        dedupe_key = f"{dedupe_key}:{recipient.pk}"[:200]
        existing = Notification.objects.filter(dedupe_key=dedupe_key).first()
        if existing:
            return existing
    try:
        with transaction.atomic():
            notification = Notification.objects.create(
                recipient=recipient,
                issue=issue,
                title=title,
                message=message,
                notification_type=notification_type,
                dedupe_key=dedupe_key,
            )
    except IntegrityError:
        return Notification.objects.filter(dedupe_key=dedupe_key).first()

    from .tasks import send_push_notification

    transaction.on_commit(lambda: send_push_notification.delay(notification.pk, high_priority))
    return notification


def issue_followers(issue):
    """The reporter plus everyone who said the issue affects them too."""
    from apps.community.models import IssueSupport

    supporter_ids = IssueSupport.objects.filter(issue=issue).values_list("user_id", flat=True)
    return [issue.reporter, *User.objects.filter(pk__in=supporter_ids, is_active=True)]


def notify_followers(issue, notification_type, title, message, event_key, exclude=None):
    for user in issue_followers(issue):
        if exclude is not None and user.pk == exclude.pk:
            continue
        notify(user, notification_type, title, message, issue=issue, dedupe_key=event_key)


def department_staff(issue, roles=("OFFICER", "SUPERVISOR")):
    """Who should hear about an issue, by location:

    1. The department's staff at the most local level that has any (ward → panchayat → taluk → district …).
    2. Otherwise the nearest area admins (e.g. the panchayat or district admin), so nobody local is missed.
    3. Otherwise — or for issues outside every service area — the global (state) administrators.
    """
    from apps.departments.jurisdiction import global_admins, nearest_staff

    if issue.service_area_id is None:
        return global_admins()
    area = issue.service_area
    if issue.department_id is not None:
        staff = nearest_staff(area, roles, department_id=issue.department_id)
        if staff.exists():
            return staff
    if "OFFICER" in roles:
        admins = nearest_staff(area, ("ADMIN",))
        if admins.exists():
            return admins
        return global_admins()
    return User.objects.none()


def notify_authority(issue, notification_type, title, message, event_key, high_priority=False, exclude=None):
    """Notify the assigned officer, or the department's staff when nobody is assigned yet."""
    recipients = [issue.assigned_officer] if issue.assigned_officer_id else list(department_staff(issue))
    if high_priority:
        supervisors = department_staff(issue, roles=("SUPERVISOR",))
        recipients = list({u.pk: u for u in [*recipients, *supervisors]}.values())
    for user in recipients:
        if exclude is not None and user.pk == exclude.pk:
            continue
        notify(user, notification_type, title, message, issue=issue, dedupe_key=event_key, high_priority=high_priority)
