from decimal import Decimal
from typing import List, Optional

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from apps.community.models import DurabilityCheck, DurabilityResponse
from apps.core.geo import approximate
from apps.departments.serializers import DepartmentMiniSerializer

from .models import (
    CaptureSource,
    CommentVisibility,
    EmergencyContact,
    ImageType,
    Issue,
    IssueCategory,
    IssueComment,
    IssueHistory,
    IssueImage,
    IssuePriorityChange,
    IssueSubcategory,
    Priority,
    Status,
)


def _abs_url(request, field):
    if not field:
        return None
    url = field.url
    return request.build_absolute_uri(url) if request else url


def _coordinate(value, minimum, maximum, label):
    if value < minimum or value > maximum:
        raise serializers.ValidationError(f"{label} must be between {minimum} and {maximum}.")
    return Decimal(str(round(value, 6)))


# ---------------------------------------------------------------------------
# Reference data
# ---------------------------------------------------------------------------

class SubcategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = IssueSubcategory
        fields = ("id", "name")


class CategoryMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = IssueCategory
        fields = ("id", "name", "slug", "icon", "is_life_threatening")


class CategorySerializer(serializers.ModelSerializer):
    subcategories = serializers.SerializerMethodField()
    default_department = DepartmentMiniSerializer(read_only=True)

    class Meta:
        model = IssueCategory
        fields = (
            "id",
            "name",
            "slug",
            "description",
            "icon",
            "default_priority",
            "is_life_threatening",
            "default_department",
            "subcategories",
        )

    @extend_schema_field(SubcategorySerializer(many=True))
    def get_subcategories(self, obj):
        return SubcategorySerializer([s for s in obj.subcategories.all() if s.is_active], many=True).data


class EmergencyContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = EmergencyContact
        fields = ("id", "name", "phone_number")


# ---------------------------------------------------------------------------
# Nested read serializers
# ---------------------------------------------------------------------------

class IssueImageSerializer(serializers.ModelSerializer):
    image_url = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()

    class Meta:
        model = IssueImage
        fields = (
            "id",
            "image_type",
            "image_url",
            "thumbnail_url",
            "caption",
            "uploaded_at",
            "resolution_cycle",
            "distance_from_issue_m",
            "proof_check_status",
        )

    def get_image_url(self, obj) -> Optional[str]:
        return _abs_url(self.context.get("request"), obj.image)

    def get_thumbnail_url(self, obj) -> Optional[str]:
        return _abs_url(self.context.get("request"), obj.thumbnail or obj.image)


class AuthorityIssueImageSerializer(IssueImageSerializer):
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True)
    overridden_by_name = serializers.CharField(source="overridden_by.full_name", read_only=True, default=None)

    class Meta(IssueImageSerializer.Meta):
        fields = IssueImageSerializer.Meta.fields + (
            "uploaded_by_name",
            "capture_source",
            "capture_latitude",
            "capture_longitude",
            "capture_accuracy_m",
            "captured_at",
            "proof_check_notes",
            "override_reason",
            "overridden_by_name",
            "overridden_at",
        )


class HistorySerializer(serializers.ModelSerializer):
    actor_label = serializers.SerializerMethodField()

    class Meta:
        model = IssueHistory
        fields = ("id", "previous_status", "new_status", "reason", "closure_type", "actor_label", "created_at")

    def get_actor_label(self, obj) -> str:
        actor = obj.changed_by
        if actor is None:
            return "System"
        viewer = getattr(self.context.get("request"), "user", None)
        if viewer is not None and actor.pk == viewer.pk:
            return "You"
        if actor.is_citizen:
            return "Reporter"
        return obj.issue.department.name if obj.issue.department_id else "Authority"


class AuthorityHistorySerializer(HistorySerializer):
    changed_by = serializers.SerializerMethodField()
    evidence_ids = serializers.PrimaryKeyRelatedField(source="evidence", many=True, read_only=True)

    class Meta(HistorySerializer.Meta):
        fields = HistorySerializer.Meta.fields + ("changed_by", "evidence_ids")

    def get_changed_by(self, obj) -> Optional[dict]:
        if obj.changed_by is None:
            return None
        return {"id": obj.changed_by.pk, "full_name": obj.changed_by.full_name, "role": obj.changed_by.role}


class CommentSerializer(serializers.ModelSerializer):
    author_name = serializers.CharField(source="author.full_name", read_only=True)
    author_role = serializers.CharField(source="author.role", read_only=True)
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = IssueComment
        fields = ("id", "comment", "visibility", "author_name", "author_role", "is_mine", "created_at")

    def get_is_mine(self, obj) -> bool:
        viewer = getattr(self.context.get("request"), "user", None)
        return bool(viewer and viewer.pk == obj.author_id)


class PriorityChangeSerializer(serializers.ModelSerializer):
    changed_by_name = serializers.CharField(source="changed_by.full_name", read_only=True)

    class Meta:
        model = IssuePriorityChange
        fields = ("id", "previous_priority", "new_priority", "reason", "changed_by_name", "created_at")


class AssignmentSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    department = DepartmentMiniSerializer()
    assigned_officer = serializers.SerializerMethodField()
    assigned_by_name = serializers.SerializerMethodField()
    assigned_at = serializers.DateTimeField()
    notes = serializers.CharField()
    is_current = serializers.BooleanField()

    def get_assigned_officer(self, obj) -> Optional[dict]:
        officer = obj.assigned_officer
        return {"id": officer.pk, "full_name": officer.full_name} if officer else None

    def get_assigned_by_name(self, obj) -> str:
        return obj.assigned_by.full_name if obj.assigned_by else "System"


def _report_thumbnail(serializer, obj):
    images = getattr(obj, "report_images", None)
    if images is None:
        images = [i for i in obj.images.all() if i.image_type == ImageType.REPORT]
    if not images:
        return None
    first = images[0]
    return _abs_url(serializer.context.get("request"), first.thumbnail or first.image)


# ---------------------------------------------------------------------------
# Citizen-facing issue serializers
# ---------------------------------------------------------------------------

class IssueListSerializer(serializers.ModelSerializer):
    category = CategoryMiniSerializer(read_only=True)
    thumbnail_url = serializers.SerializerMethodField()
    is_overdue = serializers.SerializerMethodField()

    class Meta:
        model = Issue
        fields = (
            "id",
            "complaint_id",
            "title",
            "category",
            "status",
            "priority",
            "address",
            "latitude",
            "longitude",
            "thumbnail_url",
            "impact_count",
            "is_overdue",
            "created_at",
            "updated_at",
        )

    def get_thumbnail_url(self, obj) -> Optional[str]:
        return _report_thumbnail(self, obj)

    def get_is_overdue(self, obj) -> bool:
        return obj.compute_overdue()


class IssueDetailSerializer(IssueListSerializer):
    """Full view for the reporter of the issue."""

    subcategory = SubcategorySerializer(read_only=True)
    department = DepartmentMiniSerializer(read_only=True)
    assigned_officer_name = serializers.CharField(source="assigned_officer.full_name", read_only=True, default=None)
    parent_complaint_id = serializers.CharField(source="parent_issue.complaint_id", read_only=True, default=None)
    images = IssueImageSerializer(many=True, read_only=True)
    history = HistorySerializer(many=True, read_only=True)
    comments = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()
    can_confirm = serializers.SerializerMethodField()
    can_reopen = serializers.SerializerMethodField()
    can_add_evidence = serializers.SerializerMethodField()
    supported_by_me = serializers.SerializerMethodField()
    durability_check_pending = serializers.SerializerMethodField()

    class Meta(IssueListSerializer.Meta):
        fields = IssueListSerializer.Meta.fields + (
            "description",
            "additional_details",
            "subcategory",
            "reported_urgency",
            "department",
            "assigned_officer_name",
            "acknowledged_at",
            "started_at",
            "resolved_at",
            "closed_at",
            "reopened_at",
            "due_at",
            "closure_type",
            "resolution_description",
            "reopen_count",
            "satisfaction_rating",
            "satisfaction_comment",
            "is_recurrence",
            "parent_complaint_id",
            "images",
            "history",
            "comments",
            "is_owner",
            "can_confirm",
            "can_reopen",
            "can_add_evidence",
            "supported_by_me",
            "durability_check_pending",
        )

    def _viewer(self):
        return getattr(self.context.get("request"), "user", None)

    @extend_schema_field(CommentSerializer(many=True))
    def get_comments(self, obj):
        visible = [c for c in obj.comments.all() if c.visibility == CommentVisibility.CITIZEN_VISIBLE]
        return CommentSerializer(visible, many=True, context=self.context).data

    def get_is_owner(self, obj) -> bool:
        viewer = self._viewer()
        return bool(viewer and viewer.pk == obj.reporter_id)

    def get_can_confirm(self, obj) -> bool:
        return self.get_is_owner(obj) and obj.status == Status.RESOLVED

    def get_can_reopen(self, obj) -> bool:
        from .services import can_citizen_reopen

        return self.get_is_owner(obj) and can_citizen_reopen(obj)

    def get_can_add_evidence(self, obj) -> bool:
        return self.get_is_owner(obj) and obj.status != Status.CLOSED

    def get_supported_by_me(self, obj) -> bool:
        viewer = self._viewer()
        return bool(viewer and obj.supports.filter(user=viewer).exists())

    def get_durability_check_pending(self, obj) -> bool:
        viewer = self._viewer()
        return bool(
            viewer
            and DurabilityCheck.objects.filter(
                issue=obj, recipient=viewer, response=DurabilityResponse.PENDING, sent_at__isnull=False
            ).exists()
        )


class PublicIssueSerializer(IssueListSerializer):
    """What a citizen who did not report the issue may see: no reporter data, approximate location."""

    latitude = serializers.SerializerMethodField()
    longitude = serializers.SerializerMethodField()
    images = serializers.SerializerMethodField()
    history = serializers.SerializerMethodField()
    is_owner = serializers.SerializerMethodField()
    supported_by_me = serializers.SerializerMethodField()
    can_support = serializers.SerializerMethodField()
    durability_check_pending = serializers.SerializerMethodField()

    class Meta(IssueListSerializer.Meta):
        fields = IssueListSerializer.Meta.fields + (
            "description",
            "resolved_at",
            "closed_at",
            "closure_type",
            "images",
            "history",
            "is_owner",
            "supported_by_me",
            "can_support",
            "durability_check_pending",
        )

    def get_latitude(self, obj) -> float:
        return approximate(obj.latitude)

    def get_longitude(self, obj) -> float:
        return approximate(obj.longitude)

    @extend_schema_field(IssueImageSerializer(many=True))
    def get_images(self, obj):
        public = [i for i in obj.images.all() if i.image_type in (ImageType.REPORT, ImageType.RESOLUTION)]
        return IssueImageSerializer(public, many=True, context=self.context).data

    def get_history(self, obj) -> List[dict]:
        return [{"id": h.pk, "new_status": h.new_status, "created_at": h.created_at} for h in obj.history.all()]

    def get_is_owner(self, obj) -> bool:
        return False

    def get_supported_by_me(self, obj) -> bool:
        viewer = getattr(self.context.get("request"), "user", None)
        return bool(viewer and obj.supports.filter(user=viewer).exists())

    def get_can_support(self, obj) -> bool:
        return obj.status != Status.CLOSED

    def get_durability_check_pending(self, obj) -> bool:
        viewer = getattr(self.context.get("request"), "user", None)
        return bool(
            viewer
            and DurabilityCheck.objects.filter(
                issue=obj, recipient=viewer, response=DurabilityResponse.PENDING, sent_at__isnull=False
            ).exists()
        )


class MapIssueSerializer(serializers.ModelSerializer):
    category = CategoryMiniSerializer(read_only=True)
    latitude = serializers.SerializerMethodField()
    longitude = serializers.SerializerMethodField()
    thumbnail_url = serializers.SerializerMethodField()
    is_mine = serializers.SerializerMethodField()

    class Meta:
        model = Issue
        fields = (
            "id",
            "complaint_id",
            "title",
            "category",
            "status",
            "priority",
            "latitude",
            "longitude",
            "thumbnail_url",
            "impact_count",
            "is_mine",
            "created_at",
        )

    def get_latitude(self, obj) -> float:
        return approximate(obj.latitude)

    def get_longitude(self, obj) -> float:
        return approximate(obj.longitude)

    def get_thumbnail_url(self, obj) -> Optional[str]:
        return _report_thumbnail(self, obj)

    def get_is_mine(self, obj) -> bool:
        viewer = getattr(self.context.get("request"), "user", None)
        return bool(viewer and viewer.pk == obj.reporter_id)


class DurabilityCheckSerializer(serializers.ModelSerializer):
    issue = MapIssueSerializer(read_only=True)

    class Meta:
        model = DurabilityCheck
        fields = ("id", "issue", "due_at", "sent_at")


# ---------------------------------------------------------------------------
# Authority-facing issue serializers
# ---------------------------------------------------------------------------

class OfficerMiniSerializer(serializers.Serializer):
    id = serializers.IntegerField()
    full_name = serializers.CharField()


class AuthorityIssueListSerializer(IssueListSerializer):
    department = DepartmentMiniSerializer(read_only=True)
    assigned_officer = OfficerMiniSerializer(read_only=True, allow_null=True)
    service_area_name = serializers.CharField(source="service_area.name", read_only=True, default=None)
    days_open = serializers.IntegerField(read_only=True)

    class Meta(IssueListSerializer.Meta):
        fields = IssueListSerializer.Meta.fields + (
            "description",
            "reported_urgency",
            "recommended_priority",
            "department",
            "assigned_officer",
            "service_area_name",
            "days_open",
            "due_at",
        )


class AuthorityIssueDetailSerializer(AuthorityIssueListSerializer):
    subcategory = SubcategorySerializer(read_only=True)
    reporter = serializers.SerializerMethodField()
    images = AuthorityIssueImageSerializer(many=True, read_only=True)
    history = AuthorityHistorySerializer(many=True, read_only=True)
    comments = CommentSerializer(many=True, read_only=True)
    priority_changes = PriorityChangeSerializer(many=True, read_only=True)
    assignments = AssignmentSerializer(many=True, read_only=True)
    parent_complaint_id = serializers.CharField(source="parent_issue.complaint_id", read_only=True, default=None)
    available_actions = serializers.SerializerMethodField()

    class Meta(AuthorityIssueListSerializer.Meta):
        fields = AuthorityIssueListSerializer.Meta.fields + (
            "subcategory",
            "additional_details",
            "location_accuracy_m",
            "reporter",
            "acknowledged_at",
            "started_at",
            "resolved_at",
            "closed_at",
            "reopened_at",
            "ack_due_at",
            "closure_type",
            "resolution_description",
            "resolution_cycle",
            "reopen_count",
            "satisfaction_rating",
            "satisfaction_comment",
            "is_recurrence",
            "parent_complaint_id",
            "client_reported_at",
            "images",
            "history",
            "comments",
            "priority_changes",
            "assignments",
            "available_actions",
        )

    def get_reporter(self, obj) -> dict:
        # Contact details are only exposed on this authority-only endpoint.
        r = obj.reporter
        return {"id": r.pk, "full_name": r.full_name, "email": r.email, "phone_number": r.phone_number}

    def get_available_actions(self, obj) -> List[str]:
        viewer = getattr(self.context.get("request"), "user", None)
        actions = []
        if obj.status in (Status.SUBMITTED, Status.REOPENED):
            actions.append("acknowledge")
        if obj.status in (Status.ACKNOWLEDGED, Status.REOPENED):
            actions.append("start_work")
        if obj.status == Status.IN_PROGRESS:
            actions.append("resolve")
        if obj.status in (Status.RESOLVED, Status.CLOSED):
            actions.append("reopen")
        if obj.status != Status.CLOSED:
            actions += ["assign", "change_priority"]
            if viewer is not None and viewer.is_platform_admin:
                actions.append("close")
        actions.append("comment")
        return actions


# ---------------------------------------------------------------------------
# Input serializers
# ---------------------------------------------------------------------------

class IssueCreateSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=150, min_length=5)
    description = serializers.CharField(min_length=10, max_length=5000)
    category = serializers.PrimaryKeyRelatedField(queryset=IssueCategory.objects.filter(is_active=True))
    subcategory = serializers.PrimaryKeyRelatedField(
        queryset=IssueSubcategory.objects.filter(is_active=True), required=False, allow_null=True
    )
    latitude = serializers.FloatField()
    longitude = serializers.FloatField()
    location_accuracy_m = serializers.FloatField(required=False, allow_null=True, min_value=0)
    address = serializers.CharField(max_length=255, required=False, allow_blank=True)
    additional_details = serializers.CharField(max_length=2000, required=False, allow_blank=True)
    reported_urgency = serializers.ChoiceField(
        choices=[p for p in Priority.values if p != Priority.UNCLASSIFIED], required=False, allow_blank=True
    )
    client_submission_id = serializers.UUIDField(required=False, allow_null=True)
    client_reported_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_latitude(self, value):
        return _coordinate(value, -90, 90, "Latitude")

    def validate_longitude(self, value):
        return _coordinate(value, -180, 180, "Longitude")

    def validate(self, attrs):
        subcategory = attrs.get("subcategory")
        if subcategory and subcategory.category_id != attrs["category"].pk:
            raise serializers.ValidationError({"subcategory": ["This subcategory does not belong to the selected category."]})
        return attrs


class EvidenceSerializer(serializers.Serializer):
    caption = serializers.CharField(max_length=255, required=False, allow_blank=True)


class ReasonSerializer(serializers.Serializer):
    reason = serializers.CharField(max_length=2000)


class ConfirmResolutionSerializer(serializers.Serializer):
    rating = serializers.IntegerField(min_value=1, max_value=5, required=False, allow_null=True)
    comment = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class CommentCreateSerializer(serializers.Serializer):
    comment = serializers.CharField(max_length=2000)
    visibility = serializers.ChoiceField(choices=CommentVisibility.choices, default=CommentVisibility.CITIZEN_VISIBLE)


class LocationQuerySerializer(serializers.Serializer):
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    radius_m = serializers.FloatField(min_value=10, max_value=5000, required=False)
    category = serializers.IntegerField(required=False)


class MapQuerySerializer(serializers.Serializer):
    min_lat = serializers.FloatField(min_value=-90, max_value=90)
    max_lat = serializers.FloatField(min_value=-90, max_value=90)
    min_lng = serializers.FloatField(min_value=-180, max_value=180)
    max_lng = serializers.FloatField(min_value=-180, max_value=180)


class SupportSerializer(serializers.Serializer):
    latitude = serializers.FloatField()
    longitude = serializers.FloatField()
    note = serializers.CharField(max_length=500, required=False, allow_blank=True)

    def validate_latitude(self, value):
        return _coordinate(value, -90, 90, "Latitude")

    def validate_longitude(self, value):
        return _coordinate(value, -180, 180, "Longitude")


class DurabilityAnswerSerializer(serializers.Serializer):
    response = serializers.ChoiceField(choices=(DurabilityResponse.STILL_FIXED, DurabilityResponse.PROBLEM_RETURNED))
    note = serializers.CharField(max_length=500, required=False, allow_blank=True)


class StatusActionSerializer(serializers.Serializer):
    comment = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class PriorityUpdateSerializer(serializers.Serializer):
    priority = serializers.ChoiceField(choices=Priority.choices)
    reason = serializers.CharField(max_length=2000)


class AssignSerializer(serializers.Serializer):
    department_id = serializers.IntegerField()
    officer_id = serializers.IntegerField(required=False, allow_null=True)
    notes = serializers.CharField(max_length=2000, required=False, allow_blank=True)


class ResolveSerializer(serializers.Serializer):
    resolution_description = serializers.CharField(max_length=5000)
    capture_source = serializers.ChoiceField(choices=CaptureSource.choices, required=False)
    capture_latitude = serializers.FloatField(required=False, allow_null=True)
    capture_longitude = serializers.FloatField(required=False, allow_null=True)
    capture_accuracy_m = serializers.FloatField(required=False, allow_null=True, min_value=0)
    captured_at = serializers.DateTimeField(required=False, allow_null=True)

    def validate_capture_latitude(self, value):
        return None if value is None else _coordinate(value, -90, 90, "Latitude")

    def validate_capture_longitude(self, value):
        return None if value is None else _coordinate(value, -180, 180, "Longitude")
