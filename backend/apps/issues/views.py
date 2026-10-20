from datetime import timedelta

from django.db.models import Count, Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils import timezone
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, permissions, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle, UserRateThrottle
from rest_framework.views import APIView

from apps.accounts.permissions import IsCitizen
from apps.community import services as community
from apps.core.models import get_flag
from apps.departments.models import ServiceArea

from . import services
from .models import ACTIVE_STATUSES, EmergencyContact, ImageType, Issue, IssueCategory, IssueImage, Status
from .selectors import apply_sort, nearby_issues
from .serializers import (
    CategorySerializer,
    CommentCreateSerializer,
    CommentSerializer,
    ConfirmResolutionSerializer,
    DurabilityAnswerSerializer,
    DurabilityCheckSerializer,
    EmergencyContactSerializer,
    EvidenceSerializer,
    HistorySerializer,
    IssueCreateSerializer,
    IssueDetailSerializer,
    IssueImageSerializer,
    IssueListSerializer,
    LocationQuerySerializer,
    MapIssueSerializer,
    MapQuerySerializer,
    PublicIssueSerializer,
    ReasonSerializer,
    SupportSerializer,
)

MULTIPART = [MultiPartParser, FormParser, JSONParser]


def with_report_images(qs):
    return qs.prefetch_related(
        Prefetch("images", queryset=IssueImage.objects.filter(image_type=ImageType.REPORT), to_attr="report_images")
    )


def detail_queryset():
    return Issue.objects.select_related(
        "category", "subcategory", "department", "assigned_officer", "parent_issue", "reporter"
    ).prefetch_related("images", "history__changed_by", "history__issue__department", "comments__author")


def citizen_detail(request, issue):
    serializer_class = IssueDetailSerializer if issue.reporter_id == request.user.pk else PublicIssueSerializer
    return serializer_class(issue, context={"request": request}).data


def own_issue(request, pk):
    return get_object_or_404(Issue, pk=pk, reporter=request.user)


def uploaded_images(request):
    return request.FILES.getlist("images")


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

class CategoryListView(generics.ListAPIView):
    queryset = IssueCategory.objects.filter(is_active=True).select_related("default_department").prefetch_related("subcategories")
    serializer_class = CategorySerializer
    pagination_class = None
    filter_backends = []


class EmergencyContactListView(generics.ListAPIView):
    """Emergency numbers for a location (and optionally a category) — shown before life-threatening reports."""

    serializer_class = EmergencyContactSerializer
    pagination_class = None
    filter_backends = []
    permission_classes = [permissions.AllowAny]

    @extend_schema(
        parameters=[
            OpenApiParameter("lat", float),
            OpenApiParameter("lng", float),
            OpenApiParameter("category", int),
        ]
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        qs = EmergencyContact.objects.filter(is_active=True)
        params = self.request.query_params
        area = None
        try:
            if params.get("lat") and params.get("lng"):
                area = ServiceArea.locate(float(params["lat"]), float(params["lng"]))
        except ValueError:
            area = None
        qs = qs.filter(Q(service_area__isnull=True) | Q(service_area=area)) if area else qs.filter(service_area__isnull=True)
        category = params.get("category")
        if category and category.isdigit():
            qs = qs.filter(Q(category__isnull=True) | Q(category_id=int(category)))
        else:
            qs = qs.filter(category__isnull=True)
        return qs


# ---------------------------------------------------------------------------
# Citizen issues
# ---------------------------------------------------------------------------

class IssueCreateView(APIView):
    permission_classes = [IsCitizen]
    parser_classes = MULTIPART
    throttle_classes = [ScopedRateThrottle, UserRateThrottle]
    throttle_scope = "issue_create"

    @extend_schema(request=IssueCreateSerializer, responses={201: IssueDetailSerializer})
    def post(self, request):
        serializer = IssueCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        issue, created = services.create_issue(request.user, serializer.validated_data, uploaded_images(request))
        issue = detail_queryset().get(pk=issue.pk)
        return Response(
            IssueDetailSerializer(issue, context={"request": request}).data,
            status=status.HTTP_201_CREATED if created else status.HTTP_200_OK,
        )


class MyIssuesView(generics.ListAPIView):
    """The citizen's own complaints. Filters: status (comma-separated), search, sort."""

    permission_classes = [IsCitizen]
    serializer_class = IssueListSerializer
    filter_backends = []

    @extend_schema(
        parameters=[
            OpenApiParameter("status", str, description="Comma-separated statuses"),
            OpenApiParameter("search", str),
            OpenApiParameter("sort", str, enum=["newest", "oldest", "priority", "updated"]),
        ]
    )
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        params = self.request.query_params
        qs = with_report_images(Issue.objects.filter(reporter=self.request.user).select_related("category"))
        statuses = [s for s in params.get("status", "").split(",") if s in Status.values]
        if statuses:
            qs = qs.filter(status__in=statuses)
        search = params.get("search", "").strip()
        if search:
            qs = qs.filter(Q(complaint_id__icontains=search) | Q(title__icontains=search) | Q(address__icontains=search))
        return apply_sort(qs, params.get("sort", "newest"))


class MyIssueSummaryView(APIView):
    permission_classes = [IsCitizen]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        counts = Issue.objects.filter(reporter=request.user).aggregate(
            total=Count("id"),
            open=Count("id", filter=Q(status__in=[Status.SUBMITTED, Status.ACKNOWLEDGED, Status.REOPENED])),
            in_progress=Count("id", filter=Q(status=Status.IN_PROGRESS)),
            awaiting_verification=Count("id", filter=Q(status=Status.RESOLVED)),
            closed=Count("id", filter=Q(status=Status.CLOSED)),
        )
        recent = with_report_images(
            Issue.objects.filter(reporter=request.user).select_related("category").order_by("-updated_at")[:5]
        )
        checks = community.pending_checks_for(request.user)
        return Response(
            {
                "counts": counts,
                "recent": IssueListSerializer(recent, many=True, context={"request": request}).data,
                "pending_durability_checks": DurabilityCheckSerializer(
                    checks, many=True, context={"request": request}
                ).data,
            }
        )


class IssueDetailView(APIView):
    permission_classes = [IsCitizen]

    @extend_schema(responses=IssueDetailSerializer)
    def get(self, request, pk):
        issue = get_object_or_404(detail_queryset(), pk=pk)
        return Response(citizen_detail(request, issue))


class IssueHistoryView(generics.ListAPIView):
    permission_classes = [IsCitizen]
    serializer_class = HistorySerializer
    pagination_class = None
    filter_backends = []

    def get_queryset(self):
        issue = own_issue(self.request, self.kwargs["pk"])
        return issue.history.select_related("changed_by", "issue__department")


class AdditionalEvidenceView(APIView):
    permission_classes = [IsCitizen]
    parser_classes = MULTIPART

    @extend_schema(request=EvidenceSerializer, responses={201: IssueImageSerializer(many=True)})
    def post(self, request, pk):
        issue = own_issue(request, pk)
        serializer = EvidenceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        images = services.add_additional_evidence(
            issue, request.user, uploaded_images(request), serializer.validated_data.get("caption", "")
        )
        return Response(
            IssueImageSerializer(images, many=True, context={"request": request}).data, status=status.HTTP_201_CREATED
        )


class ReopenView(APIView):
    permission_classes = [IsCitizen]
    parser_classes = MULTIPART

    @extend_schema(request=ReasonSerializer, responses=IssueDetailSerializer)
    def post(self, request, pk):
        issue = own_issue(request, pk)
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.citizen_reopen(issue, request.user, serializer.validated_data["reason"], uploaded_images(request))
        return Response(citizen_detail(request, detail_queryset().get(pk=pk)))


class ConfirmResolutionView(APIView):
    permission_classes = [IsCitizen]

    @extend_schema(request=ConfirmResolutionSerializer, responses=IssueDetailSerializer)
    def post(self, request, pk):
        issue = own_issue(request, pk)
        serializer = ConfirmResolutionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.confirm_resolution(
            issue, request.user, serializer.validated_data.get("rating"), serializer.validated_data.get("comment", "")
        )
        return Response(citizen_detail(request, detail_queryset().get(pk=pk)))


class IssueCommentsView(APIView):
    permission_classes = [IsCitizen]

    @extend_schema(responses=CommentSerializer(many=True))
    def get(self, request, pk):
        issue = own_issue(request, pk)
        comments = issue.comments.filter(visibility="CITIZEN_VISIBLE").select_related("author")
        return Response(CommentSerializer(comments, many=True, context={"request": request}).data)

    @extend_schema(request=CommentCreateSerializer, responses={201: CommentSerializer})
    def post(self, request, pk):
        issue = own_issue(request, pk)
        serializer = CommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        comment = services.add_comment(issue, request.user, serializer.validated_data["comment"])
        return Response(CommentSerializer(comment, context={"request": request}).data, status=status.HTTP_201_CREATED)


# ---------------------------------------------------------------------------
# Nearby, map and "affects me too"
# ---------------------------------------------------------------------------

class NearbyIssuesView(APIView):
    """Open issues near a point. Used for duplicate suggestions before submitting a report."""

    permission_classes = [IsCitizen]

    @extend_schema(parameters=[LocationQuerySerializer], responses=MapIssueSerializer(many=True))
    def get(self, request):
        query = LocationQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        params = query.validated_data
        flag = get_flag("duplicate_detection")
        if not flag:
            return Response([])
        radius = params.get("radius_m") or float(flag.get("radius_m", 150))
        since = timezone.now() - timedelta(days=int(flag.get("window_days", 30)))
        results = nearby_issues(
            params["lat"],
            params["lng"],
            radius,
            category_id=params.get("category"),
            since=since,
            statuses=[*ACTIVE_STATUSES, Status.RESOLVED],
            exclude_reporter=request.user,
        )
        supported = set(
            request.user.issue_supports.filter(issue_id__in=[i.pk for i, _ in results]).values_list("issue_id", flat=True)
        )
        data = []
        for issue, distance in results:
            item = MapIssueSerializer(issue, context={"request": request}).data
            item["distance_m"] = round(distance)
            item["supported_by_me"] = issue.pk in supported
            data.append(item)
        return Response(data)


class MapIssuesView(APIView):
    """Public-safe issue markers inside a bounding box. No reporter details; approximate positions."""

    permission_classes = [IsCitizen]

    @extend_schema(
        parameters=[
            MapQuerySerializer,
            OpenApiParameter("category", int),
            OpenApiParameter("status", str),
            OpenApiParameter("priority", str),
        ],
        responses=MapIssueSerializer(many=True),
    )
    def get(self, request):
        query = MapQuerySerializer(data=request.query_params)
        query.is_valid(raise_exception=True)
        box = query.validated_data
        qs = Issue.objects.select_related("category").filter(
            latitude__gte=box["min_lat"],
            latitude__lte=box["max_lat"],
            longitude__gte=box["min_lng"],
            longitude__lte=box["max_lng"],
        )
        params = request.query_params
        if params.get("category", "").isdigit():
            qs = qs.filter(category_id=int(params["category"]))
        statuses = [s for s in params.get("status", "").split(",") if s in Status.values]
        qs = qs.filter(status__in=statuses) if statuses else qs.exclude(
            status=Status.CLOSED, closed_at__lt=timezone.now() - timedelta(days=30)
        )
        priorities = [p for p in params.get("priority", "").split(",") if p]
        if priorities:
            qs = qs.filter(priority__in=priorities)
        qs = with_report_images(qs.order_by("-created_at")[:300])
        return Response(MapIssueSerializer(qs, many=True, context={"request": request}).data)


class SupportView(APIView):
    permission_classes = [IsCitizen]
    throttle_classes = [ScopedRateThrottle, UserRateThrottle]
    throttle_scope = "support"

    @extend_schema(request=SupportSerializer, responses={201: PublicIssueSerializer})
    def post(self, request, pk):
        issue = get_object_or_404(Issue.objects.select_related("category"), pk=pk)
        serializer = SupportSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        community.add_support(issue, request.user, data["latitude"], data["longitude"], data.get("note", ""))
        return Response(citizen_detail(request, detail_queryset().get(pk=pk)), status=status.HTTP_201_CREATED)

    @extend_schema(responses=PublicIssueSerializer)
    def delete(self, request, pk):
        issue = get_object_or_404(Issue, pk=pk)
        community.remove_support(issue, request.user)
        return Response(citizen_detail(request, detail_queryset().get(pk=pk)))


# ---------------------------------------------------------------------------
# Fix durability checks
# ---------------------------------------------------------------------------

class DurabilityCheckListView(APIView):
    permission_classes = [IsCitizen]

    @extend_schema(responses=DurabilityCheckSerializer(many=True))
    def get(self, request):
        checks = community.pending_checks_for(request.user)
        return Response(DurabilityCheckSerializer(checks, many=True, context={"request": request}).data)


class DurabilityResponseView(APIView):
    permission_classes = [IsCitizen]
    parser_classes = MULTIPART

    @extend_schema(request=DurabilityAnswerSerializer, responses=OpenApiTypes.OBJECT)
    def post(self, request, pk):
        issue = get_object_or_404(Issue.objects.select_related("category", "subcategory"), pk=pk)
        serializer = DurabilityAnswerSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        check = community.respond_to_durability_check(
            issue,
            request.user,
            serializer.validated_data["response"],
            serializer.validated_data.get("note", ""),
            uploaded_images(request),
        )
        follow_up = check.follow_up_issue
        return Response(
            {
                "response": check.response,
                "follow_up_issue": (
                    {"id": follow_up.pk, "complaint_id": follow_up.complaint_id} if follow_up else None
                ),
            }
        )
