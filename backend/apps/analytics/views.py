import csv

from django.http import HttpResponse
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAuthority
from apps.audit.models import log_action
from apps.issues.authority_views import FILTER_PARAMETERS, filter_authority_issues
from apps.issues.selectors import apply_sort, issues_visible_to_authority

from .services import dashboard, department_report

CSV_COLUMNS = [
    ("Complaint ID", lambda i: i.complaint_id),
    ("Title", lambda i: i.title),
    ("Category", lambda i: i.category.name),
    ("Status", lambda i: i.get_status_display()),
    ("Priority", lambda i: i.get_priority_display()),
    ("Department", lambda i: i.department.name if i.department else ""),
    ("Assigned officer", lambda i: i.assigned_officer.full_name if i.assigned_officer else ""),
    ("Service area", lambda i: i.service_area.name if i.service_area else ""),
    ("Address", lambda i: i.address),
    ("Latitude", lambda i: i.latitude),
    ("Longitude", lambda i: i.longitude),
    ("Reported at", lambda i: timezone.localtime(i.created_at).isoformat()),
    ("Acknowledged at", lambda i: timezone.localtime(i.acknowledged_at).isoformat() if i.acknowledged_at else ""),
    ("Resolved at", lambda i: timezone.localtime(i.resolved_at).isoformat() if i.resolved_at else ""),
    ("Closed at", lambda i: timezone.localtime(i.closed_at).isoformat() if i.closed_at else ""),
    ("Closure type", lambda i: i.closure_type),
    ("Due at", lambda i: timezone.localtime(i.due_at).isoformat() if i.due_at else ""),
    ("Overdue", lambda i: "yes" if i.compute_overdue() else "no"),
    ("Days open", lambda i: i.days_open),
    ("Reopen count", lambda i: i.reopen_count),
    ("Affected citizens", lambda i: i.impact_count + 1),
]


def _csv_safe(value):
    """Prevent spreadsheet formula injection from user-written text."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


class DashboardView(APIView):
    permission_classes = [IsAuthenticated, IsAuthority]

    @extend_schema(parameters=[OpenApiParameter("period", str, enum=["weekly", "monthly"])], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        qs = issues_visible_to_authority(request.user)
        return Response(dashboard(qs, request.query_params.get("period", "weekly")))


class ReportsView(APIView):
    """JSON summary by department, or a CSV export of the filtered issues with `?export=csv`."""

    permission_classes = [IsAuthenticated, IsAuthority]

    @extend_schema(parameters=[*FILTER_PARAMETERS, OpenApiParameter("export", str, enum=["csv"])], responses=OpenApiTypes.OBJECT)
    def get(self, request):
        qs = filter_authority_issues(request, issues_visible_to_authority(request.user))
        if request.query_params.get("export") == "csv":
            qs = apply_sort(qs, request.query_params.get("sort", "newest"))[:10000]
            response = HttpResponse(content_type="text/csv; charset=utf-8")
            filename = f"civiceye-report-{timezone.localtime():%Y%m%d-%H%M}.csv"
            response["Content-Disposition"] = f'attachment; filename="{filename}"'
            writer = csv.writer(response)
            writer.writerow([name for name, _ in CSV_COLUMNS])
            count = 0
            for issue in qs:
                writer.writerow([_csv_safe(getter(issue)) for _, getter in CSV_COLUMNS])
                count += 1
            log_action(request.user, "report.exported", request.user, {"rows": count, "filters": dict(request.query_params)})
            return response
        return Response({"departments": department_report(qs), "total": qs.count()})
