from django.conf import settings
from django.shortcuts import get_object_or_404
from rest_framework import generics, permissions, status
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from apps.audit.models import log_action

from . import otp
from .models import User
from .permissions import IsAuthority
from .phone import mask_phone, normalize_phone
from .serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    LogoutSerializer,
    OTPRequestSerializer,
    OTPVerifySerializer,
    ProfileUpdateSerializer,
    UserSerializer,
)

def _error(code, message, http_status=status.HTTP_400_BAD_REQUEST, details=None):
    return Response({"error": {"code": code, "message": message, "details": details or {}}}, status=http_status)


def _tokens_for(user):
    refresh = RefreshToken.for_user(user)
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


def _blacklist_all_tokens(user):
    for token in OutstandingToken.objects.filter(user=user):
        BlacklistedToken.objects.get_or_create(token=token)


class OTPRequestView(generics.GenericAPIView):
    """Send a one-time sign-in code by SMS to a citizen's mobile number (sign-in and sign-up)."""

    permission_classes = [permissions.AllowAny]
    serializer_class = OTPRequestSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "otp_request"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = normalize_phone(serializer.validated_data["phone_number"])
        try:
            otp.request_code(phone)
        except otp.OTPError as exc:
            return _error(exc.code, exc.message, exc.status, exc.details)
        return Response(
            {
                "detail": (
                    f"Test mode: enter the {settings.OTP_LENGTH}-digit test code."
                    if settings.DEBUG and settings.OTP_TEST_CODE
                    else f"We sent a {settings.OTP_LENGTH}-digit code to {mask_phone(phone)}."
                ),
                "code_length": settings.OTP_LENGTH,
                "phone_number": phone,
                "expires_in": settings.OTP_TTL_SECONDS,
                "resend_after": settings.OTP_RESEND_COOLDOWN_SECONDS,
            }
        )


class OTPVerifyView(generics.GenericAPIView):
    """Verify the code. Returns tokens, or `name_required` for a new number (send again with full_name)."""

    permission_classes = [permissions.AllowAny]
    serializer_class = OTPVerifySerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "otp_verify"

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        phone = normalize_phone(data["phone_number"])
        try:
            # Errors are returned, not raised, so a wrong attempt is still counted despite ATOMIC_REQUESTS.
            result = otp.verify_code(phone, data["code"], data.get("full_name", ""))
        except otp.OTPError as exc:
            return _error(exc.code, exc.message, exc.status, exc.details)
        if result.name_required:
            return Response({"status": "name_required", "phone_number": phone})
        return Response(
            {
                "status": "authenticated",
                "is_new_user": result.created,
                **_tokens_for(result.user),
                "user": UserSerializer(result.user).data,
            },
            status=status.HTTP_201_CREATED if result.created else status.HTTP_200_OK,
        )


class LoginView(TokenObtainPairView):
    serializer_class = LoginSerializer
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class RefreshView(TokenRefreshView):
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "auth"


class LogoutView(generics.GenericAPIView):
    serializer_class = LogoutSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            token = RefreshToken(serializer.validated_data["refresh"])
            if str(token.get("user_id")) != str(request.user.pk):
                return _error("invalid_token", "This token does not belong to you.")
            token.blacklist()
        except TokenError:
            # Already expired or blacklisted: the session is over either way.
            pass
        return Response(status=status.HTTP_205_RESET_CONTENT)


class MeView(generics.RetrieveAPIView):
    serializer_class = UserSerializer

    def get_object(self):
        return self.request.user


class ProfileView(generics.UpdateAPIView):
    serializer_class = ProfileUpdateSerializer
    http_method_names = ["patch"]

    def get_object(self):
        return self.request.user

    def update(self, request, *args, **kwargs):
        kwargs["partial"] = True
        before = {"username": request.user.username, "email": request.user.email}
        super().update(request, *args, **kwargs)
        request.user.refresh_from_db()
        changed = {field: {"from": old, "to": getattr(request.user, field)} for field, old in before.items() if getattr(request.user, field) != old}
        if changed:
            # Login identifiers are sensitive: record who changed what.
            log_action(request.user, "user.login_details_changed", request.user, changed)
        return Response(UserSerializer(request.user).data)


class ChangePasswordView(generics.GenericAPIView):
    serializer_class = ChangePasswordSerializer

    def post(self, request):
        if request.user.is_citizen:
            return _error("not_available", "Citizen accounts sign in with a one-time code and have no password.")
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])
        _blacklist_all_tokens(request.user)
        log_action(request.user, "user.password_changed", request.user)
        return Response({**_tokens_for(request.user), "user": UserSerializer(request.user).data})


class OfficerListView(generics.ListAPIView):
    """Officers an authority user may assign issues to.

    `?issue=<id>` limits the list to officers whose service areas cover that issue's location.
    """

    serializer_class = UserSerializer
    pagination_class = None
    filter_backends = []

    permission_classes = [permissions.IsAuthenticated, IsAuthority]

    def get_queryset(self):
        user = self.request.user
        qs = User.objects.filter(is_active=True, role__in=["OFFICER", "SUPERVISOR"]).select_related("department")
        department_id = self.request.query_params.get("department")
        if department_id:
            qs = qs.filter(department_id=department_id)
        if not user.is_supervisor_or_admin:
            qs = qs.filter(department_id=user.department_id)
        elif user.role == "SUPERVISOR" and not department_id:
            qs = qs.filter(department_id=user.department_id)
        issue_id = self.request.query_params.get("issue")
        if issue_id and issue_id.isdigit():
            from apps.issues.selectors import issues_visible_to_authority

            issue = get_object_or_404(issues_visible_to_authority(user), pk=int(issue_id))
            # Staff assigned to the issue's area or any area above it (a district officer covers its panchayats).
            qs = qs.filter(service_areas__in=issue.service_area.ancestor_ids()) if issue.service_area_id else qs.none()
        return qs.distinct().prefetch_related("service_areas")
