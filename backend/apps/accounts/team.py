"""Team management for hierarchical administration.

Each admin manages the staff of their own jurisdiction: a district admin creates and manages taluk,
panchayat and municipality admins, supervisors and officers inside that district — never anyone
outside it, never a global admin, and never their own account (no self-escalation).
"""
from django.contrib.auth import password_validation
from django.db import transaction
from django.db.models import Q
from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema
from rest_framework import generics, serializers, status
from rest_framework.exceptions import PermissionDenied
from rest_framework.permissions import BasePermission, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

from apps.audit.models import log_action
from apps.departments.jurisdiction import areas_within, is_global_admin, jurisdiction_ids
from apps.departments.models import Department, ServiceArea

from .models import Role, User, username_validator
from .permissions import IsAuthority

STAFF_ROLES = (Role.OFFICER, Role.SUPERVISOR, Role.ADMIN)


class IsAdminRole(BasePermission):
    message = "Only administrators can manage staff accounts."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.role == Role.ADMIN)


def manageable_staff(requester):
    """Staff accounts the requester may see and manage (all of their areas inside the requester's jurisdiction)."""
    qs = User.objects.filter(role__in=STAFF_ROLES).select_related("department").prefetch_related("service_areas")
    ids = jurisdiction_ids(requester)
    if ids is None:
        return qs.exclude(pk=requester.pk)
    return (
        qs.filter(service_areas__in=ids)
        .exclude(service_areas__in=ServiceArea.objects.exclude(id__in=ids))
        .exclude(pk=requester.pk)
        .distinct()
    )


# ---------------------------------------------------------------------------
# Serializers
# ---------------------------------------------------------------------------

class AreaSerializer(serializers.ModelSerializer):
    level_label = serializers.CharField(source="get_level_display", read_only=True)
    depth = serializers.IntegerField(read_only=True)

    class Meta:
        model = ServiceArea
        fields = ("id", "name", "code", "level", "level_label", "parent", "depth", "path")


class TeamMemberSerializer(serializers.ModelSerializer):
    department = serializers.SerializerMethodField()
    service_areas = AreaSerializer(many=True, read_only=True)
    is_global_admin = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "full_name",
            "email",
            "phone_number",
            "role",
            "department",
            "service_areas",
            "is_global_admin",
            "is_active",
            "last_login",
            "date_joined",
        )

    def get_department(self, obj) -> dict | None:
        return {"id": obj.department_id, "name": obj.department.name} if obj.department_id else None

    def get_is_global_admin(self, obj) -> bool:
        return is_global_admin(obj)


class TeamMemberWriteSerializer(serializers.Serializer):
    username = serializers.CharField(max_length=50)
    full_name = serializers.CharField(max_length=150)
    email = serializers.EmailField(required=False, allow_blank=True, allow_null=True)
    phone_number = serializers.CharField(max_length=16, required=False, allow_blank=True)
    role = serializers.ChoiceField(choices=[(r.value, r.label) for r in STAFF_ROLES])
    department_id = serializers.IntegerField(required=False, allow_null=True)
    service_area_ids = serializers.ListField(child=serializers.IntegerField(), required=False)
    is_active = serializers.BooleanField(required=False)
    password = serializers.CharField(required=False, write_only=True, trim_whitespace=False)

    def _requester(self):
        return self.context["request"].user

    def validate_username(self, value):
        value = value.strip().lower()
        username_validator(value)
        if User.objects.filter(username__iexact=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("This username is already taken.")
        return value

    def validate_email(self, value):
        value = (value or "").strip().lower() or None
        if value and User.objects.filter(email__iexact=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("This email is already used by another account.")
        return value

    def validate_full_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Enter the full name.")
        return value

    def validate(self, attrs):
        requester = self._requester()
        instance = self.instance
        role = attrs.get("role", instance.role if instance else None)

        if instance is None and not attrs.get("password"):
            raise serializers.ValidationError({"password": ["Set an initial password."]})
        if attrs.get("password"):
            password_validation.validate_password(attrs["password"], instance)

        # Department: required for officers and supervisors; admins manage all departments of their area.
        if "department_id" in attrs or instance is None:
            dept_id = attrs.get("department_id")
            attrs["department"] = Department.objects.filter(pk=dept_id, is_active=True).first() if dept_id else None
            if dept_id and attrs["department"] is None:
                raise serializers.ValidationError({"department_id": ["Unknown department."]})
        department = attrs.get("department", instance.department if instance else None)
        if role in (Role.OFFICER, Role.SUPERVISOR) and department is None:
            raise serializers.ValidationError({"department_id": ["Officers and supervisors must belong to a department."]})
        if role == Role.ADMIN:
            attrs["department"] = None

        # Service areas: the new account's jurisdiction must lie inside the requester's.
        if "service_area_ids" in attrs or instance is None:
            ids = list(dict.fromkeys(attrs.get("service_area_ids") or []))
            areas = list(ServiceArea.objects.filter(pk__in=ids, is_active=True))
            if len(areas) != len(ids):
                raise serializers.ValidationError({"service_area_ids": ["One or more areas do not exist."]})
            attrs["service_areas"] = areas
        areas = attrs.get("service_areas", list(instance.service_areas.all()) if instance else [])
        if not areas:
            if role != Role.ADMIN or not is_global_admin(requester):
                raise serializers.ValidationError(
                    {"service_area_ids": ["Choose at least one area. Staff only handle issues located inside their areas."]}
                )
        if not areas_within(requester, areas):
            raise serializers.ValidationError({"service_area_ids": ["You can only assign areas inside your own jurisdiction."]})
        return attrs

    @transaction.atomic
    def create(self, validated_data):
        areas = validated_data.pop("service_areas", [])
        validated_data.pop("service_area_ids", None)
        validated_data.pop("department_id", None)
        password = validated_data.pop("password")
        user = User.objects.create_user(validated_data.pop("username"), password, **validated_data)
        user.service_areas.set(areas)
        return user

    @transaction.atomic
    def update(self, instance, validated_data):
        areas = validated_data.pop("service_areas", None)
        validated_data.pop("service_area_ids", None)
        validated_data.pop("department_id", None)
        validated_data.pop("password", None)  # passwords change only through reset-password
        for field, value in validated_data.items():
            setattr(instance, field, value)
        instance.full_clean(exclude=["password"])
        instance.save()
        if areas is not None:
            instance.service_areas.set(areas)
        return instance


class PasswordResetByAdminSerializer(serializers.Serializer):
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)


def _snapshot(user):
    return {
        "username": user.username,
        "full_name": user.full_name,
        "email": user.email,
        "role": user.role,
        "department": user.department_id,
        "service_areas": sorted(user.service_areas.values_list("code", flat=True)),
        "is_active": user.is_active,
    }


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------

class TeamListCreateView(generics.ListCreateAPIView):
    """GET: staff in my jurisdiction (filters: role, area, department, active, search). POST: create staff."""

    permission_classes = [IsAuthenticated, IsAdminRole]
    filter_backends = []

    def get_serializer_class(self):
        return TeamMemberWriteSerializer if self.request.method == "POST" else TeamMemberSerializer

    def get_queryset(self):
        params = self.request.query_params
        qs = manageable_staff(self.request.user)
        if params.get("role") in STAFF_ROLES:
            qs = qs.filter(role=params["role"])
        if params.get("department", "").isdigit():
            qs = qs.filter(department_id=int(params["department"]))
        if params.get("area", "").isdigit():
            area = ServiceArea.objects.filter(pk=int(params["area"])).first()
            qs = qs.filter(service_areas__path__startswith=area.path).distinct() if area else qs.none()
        if params.get("active") in ("true", "false"):
            qs = qs.filter(is_active=params["active"] == "true")
        search = params.get("search", "").strip()
        if search:
            qs = qs.filter(Q(username__icontains=search) | Q(full_name__icontains=search) | Q(phone_number__icontains=search))
        return qs.order_by("role", "full_name")

    def create(self, request, *args, **kwargs):
        serializer = TeamMemberWriteSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)
        user = serializer.save()
        log_action(request.user, "team.member_created", user, _snapshot(user))
        return Response(TeamMemberSerializer(user).data, status=status.HTTP_201_CREATED)


class TeamDetailView(APIView):
    permission_classes = [IsAuthenticated, IsAdminRole]

    def get_member(self, request, pk):
        if int(pk) == request.user.pk:
            raise PermissionDenied("Edit your own details from your profile; ask a higher admin to change your role or areas.")
        return get_object_or_404(manageable_staff(request.user), pk=pk)

    @extend_schema(responses=TeamMemberSerializer)
    def get(self, request, pk):
        return Response(TeamMemberSerializer(self.get_member(request, pk)).data)

    @extend_schema(request=TeamMemberWriteSerializer, responses=TeamMemberSerializer)
    def patch(self, request, pk):
        member = self.get_member(request, pk)
        before = _snapshot(member)
        data = {**TeamMemberSerializer(member).data, **request.data}
        data.setdefault("department_id", member.department_id)
        data.setdefault("service_area_ids", [a.pk for a in member.service_areas.all()])
        data.pop("password", None)
        serializer = TeamMemberWriteSerializer(member, data=data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        member = serializer.save()
        after = _snapshot(member)
        changes = {k: {"from": before[k], "to": after[k]} for k in after if before[k] != after[k]}
        if changes:
            log_action(request.user, "team.member_updated", member, changes)
        if before["is_active"] and not after["is_active"]:
            _end_sessions(member)
        return Response(TeamMemberSerializer(member).data)


class TeamResetPasswordView(TeamDetailView):
    http_method_names = ["post"]

    @extend_schema(request=PasswordResetByAdminSerializer, responses={200: None})
    def post(self, request, pk):
        member = self.get_member(request, pk)
        serializer = PasswordResetByAdminSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        password_validation.validate_password(serializer.validated_data["new_password"], member)
        member.set_password(serializer.validated_data["new_password"])
        member.save(update_fields=["password"])
        _end_sessions(member)
        log_action(request.user, "team.password_reset", member)
        return Response({"detail": f"Password reset for {member.username}. Their other sessions were signed out."})


def _end_sessions(user):
    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)


class AreaListView(generics.ListAPIView):
    """Areas inside my jurisdiction, as a flat list in tree order (parents before children)."""

    permission_classes = [IsAuthenticated, IsAuthority]
    serializer_class = AreaSerializer
    pagination_class = None
    filter_backends = []

    def get_queryset(self):
        qs = ServiceArea.objects.filter(is_active=True).order_by("path")
        ids = jurisdiction_ids(self.request.user)
        return qs if ids is None else qs.filter(pk__in=ids)
