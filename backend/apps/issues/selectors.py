from django.db.models import Case, IntegerField, Q, Value, When
from django.utils import timezone

from apps.core.geo import bounding_box, haversine_m

from .models import ACTIVE_STATUSES, PRIORITY_RANK, Issue, Status


def issues_visible_to_authority(user):
    """Issues an authority user may see and act on, by jurisdiction (see apps.departments.jurisdiction).

    - Global admin: everything, including issues outside every service area.
    - Area admin (district / taluk / panchayat / municipality): all departments' issues inside their
      areas and every area below them.
    - Supervisor / officer: their department's issues inside their areas and below, plus anything
      assigned to them personally. Staff without any area see only issues assigned to them.
    """
    from apps.departments.jurisdiction import jurisdiction_ids

    qs = Issue.objects.select_related(
        "category", "subcategory", "department", "assigned_officer", "service_area", "reporter"
    )
    if user.role not in ("ADMIN", "SUPERVISOR", "OFFICER"):
        return qs.none()
    area_ids = jurisdiction_ids(user)
    if area_ids is None:
        return qs
    if user.role == "ADMIN":
        return qs.filter(Q(service_area_id__in=area_ids) | Q(assigned_officer=user))
    return qs.filter(Q(department_id=user.department_id, service_area_id__in=area_ids) | Q(assigned_officer=user))


def overdue_q(now=None):
    now = now or timezone.now()
    return Q(status__in=ACTIVE_STATUSES) & (
        Q(due_at__lt=now) | Q(status__in=[Status.SUBMITTED, Status.REOPENED], ack_due_at__lt=now)
    )


def annotate_priority_rank(qs):
    return qs.annotate(
        priority_rank=Case(
            *[When(priority=p, then=Value(rank)) for p, rank in PRIORITY_RANK.items()],
            default=Value(0),
            output_field=IntegerField(),
        )
    )


SORT_OPTIONS = {
    "newest": ("-created_at",),
    "oldest": ("created_at",),
    "priority": ("-priority_rank", "-created_at"),
    "longest_unresolved": ("created_at",),
    "updated": ("-updated_at",),
}


def apply_sort(qs, sort):
    sort = sort if sort in SORT_OPTIONS else "newest"
    if sort == "priority":
        qs = annotate_priority_rank(qs)
    if sort == "longest_unresolved":
        qs = qs.filter(status__in=ACTIVE_STATUSES)
    return qs.order_by(*SORT_OPTIONS[sort])


def nearby_issues(latitude, longitude, radius_m, category_id=None, since=None, statuses=None, limit=20, exclude_reporter=None):
    """Issues within `radius_m`, nearest first, as a list of (issue, distance_m)."""
    min_lat, max_lat, min_lng, max_lng = bounding_box(latitude, longitude, radius_m)
    qs = Issue.objects.select_related("category").filter(
        latitude__gte=min_lat, latitude__lte=max_lat, longitude__gte=min_lng, longitude__lte=max_lng
    )
    if statuses:
        qs = qs.filter(status__in=statuses)
    if category_id:
        qs = qs.filter(category_id=category_id)
    if since:
        qs = qs.filter(created_at__gte=since)
    if exclude_reporter is not None:
        qs = qs.exclude(reporter=exclude_reporter)
    results = []
    for issue in qs[:500]:
        distance = haversine_m(latitude, longitude, issue.latitude, issue.longitude)
        if distance <= radius_m:
            results.append((issue, distance))
    results.sort(key=lambda pair: pair[1])
    return results[:limit]
