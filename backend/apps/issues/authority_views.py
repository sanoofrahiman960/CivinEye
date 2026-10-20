from django.contrib.auth import get_user_model
from django.db.models import Prefetch, Q
from django.shortcuts import get_object_or_404
from django.utils.dateparse import parse_date
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.accounts.permissions import IsAuthority, IsPlatformAdmin, IsSupervisorOrAdmin
from apps.departments.models import Department

from . import services
from .models import ImageType, Issue, IssueImage, Priority, Status
from .selectors import apply_sort, issues_visible_to_authority, overdue_q
from .serializers import (
    AssignSerializer,
    AuthorityIssueDetailSerializer,
    AuthorityIssueImageSerializer,
    AuthorityIssueListSerializer,
    CommentCreateSerializer,
    CommentSerializer,
    PriorityUpdateSerializer,
    ReasonSerializer,
    ResolveSerializer,
    StatusActionSerializer,
)
from .views import MULTIPART, uploaded_images

User = get_user_model()

FILTER_PARAMETERS = [
    OpenApiParameter("priority", str, description="Comma-separated priorities"),
    OpenApiParameter("status", str, description="Comma-separated statuses"),
    OpenApiParameter("category", int),
    OpenApiParameter("department", int),
    OpenApiParameter("assigned_officer", str, description="Officer id, or 'me' / 'unassigned'"),
    OpenApiParameter("service_area", int),
    OpenApiParameter("date_from", str, description="YYYY-MM-DD"),
    OpenApiParameter("date_to", str, description="YYYY-MM-DD"),
    OpenApiParameter("overdue", bool),
    OpenApiParameter("search", str, description="Complaint ID, title or address"),
    OpenApiParameter("sort", str, enum=["newest", "oldest", "priority", "longest_unresolved"]),
]


def filter_authority_issues(request, qs):
    params = request.query_params
    priorities = [p for p in params.get("priority", "").split(",") if p in Priority.values]
    if priorities:
        qs = qs.filter(priority__in=priorities)
    statuses = [s for s in params.get("status", "").split(",") if s in Status.values]
    if statuses:
        qs = qs.filter(status__in=statuses)
    for field in ("category", "department"):
        value = params.get(field, "")
        if value.isdigit():
            qs = qs.filter(**{f"{field}_id": int(value)})
    area = params.get("service_area", "")
    if area.isdigit():
        from apps.departments.models import ServiceArea

        selected = ServiceArea.objects.filter(pk=int(area)).first()
        qs = qs.filter(service_area__path__startswith=selected.path) if selected else qs.none()
    officer = params.get("assigned_officer", "")
    if officer == "me":
        qs = qs.filter(assigned_officer=request.user)
    elif officer == "unassigned":
        qs = qs.filter(assigned_officer__isnull=True)
    elif officer.isdigit():
        qs = qs.filter(assigned_officer_id=int(officer))
    date_from = parse_date(params.get("date_from", "") or "")
    if date_from:
        qs = qs.filter(created_at__date__gte=date_from)
    date_to = parse_date(params.get("date_to", "") or "")
    if date_to:
        qs = qs.filter(created_at__date__lte=date_to)
    if params.get("overdue") in ("1", "true"):
        qs = qs.filter(overdue_q())
    search = params.get("search", "").strip()
    if search:
        qs = qs.filter(Q(complaint_id__icontains=search) | Q(title__icontains=search) | Q(address__icontains=search))
    return qs


class AuthorityMixin:
    permission_classes = [IsAuthenticated, IsAuthority]

    def scoped_issue(self, pk):
        return get_object_or_404(issues_visible_to_authority(self.request.user), pk=pk)

    def detail_response(self, pk, http_status=status.HTTP_200_OK, base_queryset=None):
        base = base_queryset if base_queryset is not None else issues_visible_to_authority(self.request.user)
        issue = get_object_or_404(
            base.select_related("category", "subcategory", "department", "assigned_officer", "service_area", "reporter", "parent_issue")
            .prefetch_related(
                "images__uploaded_by",
                "images__overridden_by",
                "history__changed_by",
                "history__evidence",
                "history__issue__department",
                "comments__author",
                "priority_changes__changed_by",
                "assignments__department",
                "assignments__assigned_officer",
                "assignments__assigned_by",
            ),
            pk=pk,
        )
        return Response(AuthorityIssueDetailSerializer(issue, context={"request": self.request}).data, status=http_status)


class AuthorityIssueListView(AuthorityMixin, generics.ListAPIView):
    serializer_class = AuthorityIssueListSerializer
    filter_backends = []

    @extend_schema(parameters=FILTER_PARAMETERS)
    def get(self, request, *args, **kwargs):
        return super().get(request, *args, **kwargs)

    def get_queryset(self):
        qs = issues_visible_to_authority(self.request.user).prefetch_related(
            Prefetch("images", queryset=IssueImage.objects.filter(image_type=ImageType.REPORT), to_attr="report_images")
        )
        qs = filter_authority_issues(self.request, qs)
        return apply_sort(qs, self.request.query_params.get("sort", "newest"))


class AuthorityIssueDetailView(AuthorityMixin, APIView):
    @extend_schema(responses=AuthorityIssueDetailSerializer)
    def get(self, request, pk):
        return self.detail_response(pk)


class AcknowledgeView(AuthorityMixin, APIView):
    @extend_schema(request=StatusActionSerializer, responses=AuthorityIssueDetailSerializer)
    def post(self, request, pk):
        serializer = StatusActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.acknowledge(self.scoped_issue(pk), request.user, serializer.validated_data.get("comment", ""))
        return self.detail_response(pk)


class StartWorkView(AuthorityMixin, APIView):
    @extend_schema(request=StatusActionSerializer, responses=AuthorityIssueDetailSerializer)
    def post(self, request, pk):
        serializer = StatusActionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.start_work(self.scoped_issue(pk), request.user, serializer.validated_data.get("comment", ""))
        return self.detail_response(pk)


class ResolveView(AuthorityMixin, APIView):
    parser_classes = MULTIPART

    @extend_schema(request=ResolveSerializer, responses={200: AuthorityIssueDetailSerializer, 409: None})
    def post(self, request, pk):
        serializer = ResolveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        resolved, new_images = services.resolve(
            self.scoped_issue(pk), request.user, data["resolution_description"], uploaded_images(request), data
        )
        if not resolved:
            # Returned rather than raised so the flagged photos are kept for a supervisor to review.
            return Response(
                {
                    "error": {
                        "code": "proof_check_flagged",
                        "message": "The resolution photo did not pass the location/originality check. "
                        "Retake it at the issue location, or ask a supervisor to review it.",
                        "details": {
                            "images": AuthorityIssueImageSerializer(
                                new_images, many=True, context={"request": request}
                            ).data
                        },
                    }
                },
                status=status.HTTP_409_CONFLICT,
            )
        return self.detail_response(pk)


class AuthorityReopenView(AuthorityMixin, APIView):
    @extend_schema(request=ReasonSerializer, responses=AuthorityIssueDetailSerializer)
    def post(self, request, pk):
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.authority_reopen(self.scoped_issue(pk), request.user, serializer.validated_data["reason"])
        return self.detail_response(pk)


class AdminCloseView(AuthorityMixin, APIView):
    permission_classes = [IsAuthenticated, IsPlatformAdmin]

    @extend_schema(request=ReasonSerializer, responses=AuthorityIssueDetailSerializer)
    def post(self, request, pk):
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.admin_close(self.scoped_issue(pk), request.user, serializer.validated_data["reason"])
        return self.detail_response(pk)


class PriorityView(AuthorityMixin, APIView):
    @extend_schema(request=PriorityUpdateSerializer, responses=AuthorityIssueDetailSerializer)
    def patch(self, request, pk):
        serializer = PriorityUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        services.change_priority(self.scoped_issue(pk), request.user, data["priority"], data["reason"])
        return self.detail_response(pk)


class AssignView(AuthorityMixin, APIView):
    @extend_schema(request=AssignSerializer, responses=AuthorityIssueDetailSerializer)
    def post(self, request, pk):
        serializer = AssignSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        department = get_object_or_404(Department, pk=data["department_id"], is_active=True)
        officer = None
        if data.get("officer_id"):
            officer = User.objects.filter(pk=data["officer_id"]).first()
            if officer is None:
                return Response(
                    {"error": {"code": "validation_error", "message": "officer_id: Officer not found.",
                               "details": {"officer_id": ["Officer not found."]}}},
                    status=status.HTTP_400_BAD_REQUEST,
                )
        services.assign(self.scoped_issue(pk), request.user, department, officer, data.get("notes", ""))
        # A transfer to another department can remove the actor's own access; still return the final state
        # of the issue they just acted on so the app can show it and navigate away.
        return self.detail_response(pk, base_queryset=Issue.objects.all())


class AuthorityCommentView(AuthorityMixin, APIView):
    @extend_schema(request=CommentCreateSerializer, responses={201: CommentSerializer})
    def post(self, request, pk):
        serializer = CommentCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        comment = services.add_comment(self.scoped_issue(pk), request.user, data["comment"], data["visibility"])
        return Response(CommentSerializer(comment, context={"request": request}).data, status=status.HTTP_201_CREATED)


class ProofCheckOverrideView(APIView):
    permission_classes = [IsAuthenticated, IsSupervisorOrAdmin]

    @extend_schema(request=ReasonSerializer, responses=AuthorityIssueImageSerializer)
    def post(self, request, pk):
        image = get_object_or_404(
            IssueImage.objects.select_related("issue"),
            pk=pk,
            image_type=ImageType.RESOLUTION,
            issue__in=issues_visible_to_authority(request.user),
        )
        serializer = ReasonSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        services.override_proof_check(image, request.user, serializer.validated_data["reason"])
        return Response(AuthorityIssueImageSerializer(image, context={"request": request}).data)
