from collections import Counter
from datetime import datetime, time, timedelta
from statistics import mean, median

from django.db.models import Count, Q
from django.utils import timezone

from apps.issues.models import Priority, Status
from apps.issues.selectors import overdue_q


def _hours(delta):
    return round(delta.total_seconds() / 3600, 1)


def _duration_stats(pairs):
    durations = [end - start for start, end in pairs if start and end and end >= start]
    if not durations:
        return {"average_hours": None, "median_hours": None, "sample_size": 0}
    hours = [_hours(d) for d in durations]
    return {"average_hours": round(mean(hours), 1), "median_hours": round(median(hours), 1), "sample_size": len(hours)}


def dashboard(qs, period="weekly"):
    """KPIs and chart series for the given (already permission-scoped) issue queryset."""
    now = timezone.now()
    kpis = qs.aggregate(
        total=Count("id"),
        awaiting_review=Count("id", filter=Q(status__in=[Status.SUBMITTED, Status.REOPENED])),
        critical_high=Count(
            "id", filter=Q(priority__in=[Priority.CRITICAL, Priority.HIGH]) & ~Q(status=Status.CLOSED)
        ),
        in_progress=Count("id", filter=Q(status=Status.IN_PROGRESS)),
        overdue=Count("id", filter=overdue_q(now)),
        awaiting_verification=Count("id", filter=Q(status=Status.RESOLVED)),
        reopened=Count("id", filter=Q(status=Status.REOPENED)),
        closed=Count("id", filter=Q(status=Status.CLOSED)),
    )

    by_category = [
        {"label": row["category__name"], "value": row["count"]}
        for row in qs.values("category__name").annotate(count=Count("id")).order_by("-count")
    ]
    status_counts = dict(qs.values_list("status").annotate(count=Count("id")))
    by_status = [{"key": value, "label": label, "value": status_counts.get(value, 0)} for value, label in Status.choices]
    priority_counts = dict(qs.values_list("priority").annotate(count=Count("id")))
    by_priority = [
        {"key": value, "label": label, "value": priority_counts.get(value, 0)} for value, label in Priority.choices
    ]

    if period == "monthly":
        buckets = []
        local_now = timezone.localtime(now)
        year, month = local_now.year, local_now.month
        for _ in range(6):
            buckets.append((year, month))
            month -= 1
            if month == 0:
                year, month = year - 1, 12
        buckets.reverse()
        start = timezone.make_aware(datetime(buckets[0][0], buckets[0][1], 1))
        created = Counter(
            (timezone.localtime(c).year, timezone.localtime(c).month)
            for c in qs.filter(created_at__gte=start).values_list("created_at", flat=True)
        )
        resolved = Counter(
            (timezone.localtime(c).year, timezone.localtime(c).month)
            for c in qs.filter(resolved_at__gte=start).values_list("resolved_at", flat=True)
        )
        trend = [
            {
                "label": datetime(y, m, 1).strftime("%b %Y"),
                "reported": created.get((y, m), 0),
                "resolved": resolved.get((y, m), 0),
            }
            for y, m in buckets
        ]
    else:
        today = timezone.localtime(now).date()
        week_start = today - timedelta(days=today.weekday())
        starts = [week_start - timedelta(weeks=i) for i in range(7, -1, -1)]
        start_dt = timezone.make_aware(datetime.combine(starts[0], time.min))

        def week_of(dt):
            d = timezone.localtime(dt).date()
            return d - timedelta(days=d.weekday())

        created = Counter(week_of(c) for c in qs.filter(created_at__gte=start_dt).values_list("created_at", flat=True))
        resolved = Counter(week_of(c) for c in qs.filter(resolved_at__gte=start_dt).values_list("resolved_at", flat=True))
        trend = [
            {"label": s.strftime("%d %b"), "reported": created.get(s, 0), "resolved": resolved.get(s, 0)} for s in starts
        ]

    recent = qs.filter(created_at__gte=now - timedelta(days=90))
    resolution = _duration_stats(recent.filter(resolved_at__isnull=False).values_list("created_at", "resolved_at"))
    acknowledgement = _duration_stats(
        recent.filter(acknowledged_at__isnull=False).values_list("created_at", "acknowledged_at")
    )

    return {
        "kpis": kpis,
        "by_category": by_category,
        "by_status": by_status,
        "by_priority": by_priority,
        "trend": {"period": "monthly" if period == "monthly" else "weekly", "points": trend},
        "resolution_time": resolution,
        "acknowledgement_time": acknowledgement,
        "generated_at": now,
    }


def department_report(qs):
    """Per-department performance for the reports screen."""
    rows = []
    for row in (
        qs.values("department_id", "department__name")
        .annotate(
            total=Count("id"),
            open=Count("id", filter=~Q(status__in=[Status.RESOLVED, Status.CLOSED])),
            resolved=Count("id", filter=Q(status__in=[Status.RESOLVED, Status.CLOSED])),
            overdue=Count("id", filter=overdue_q()),
            reopened=Count("id", filter=Q(reopen_count__gt=0)),
        )
        .order_by("department__name")
    ):
        dept_qs = qs.filter(department_id=row["department_id"], resolved_at__isnull=False)
        stats = _duration_stats(dept_qs.values_list("created_at", "resolved_at"))
        rows.append(
            {
                "department_id": row["department_id"],
                "department": row["department__name"] or "Unassigned",
                "total": row["total"],
                "open": row["open"],
                "resolved": row["resolved"],
                "overdue": row["overdue"],
                "reopen_rate": round(row["reopened"] / row["resolved"], 3) if row["resolved"] else None,
                "average_resolution_hours": stats["average_hours"],
            }
        )
    return rows
