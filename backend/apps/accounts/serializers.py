from django.contrib.auth import password_validation
from rest_framework import serializers
from rest_framework.exceptions import PermissionDenied
from rest_framework_simplejwt.serializers import TokenObtainPairSerializer

from apps.departments.jurisdiction import is_global_admin
from apps.departments.serializers import DepartmentMiniSerializer, ServiceAreaSerializer

from .models import User, username_validator


class UserSerializer(serializers.ModelSerializer):
    department = DepartmentMiniSerializer(read_only=True)
    service_areas = ServiceAreaSerializer(many=True, read_only=True)
    is_global_admin = serializers.SerializerMethodField()
    is_authority = serializers.BooleanField(read_only=True)

    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "full_name",
            "email",
            "phone_number",
            "role",
            "is_authority",
            "is_global_admin",
            "department",
            "service_areas",
            "preferred_language",
            "date_joined",
        )
        read_only_fields = fields

    def get_is_global_admin(self, obj) -> bool:
        """State/system admin (no area restriction). Area admins and other staff are False."""
        return is_global_admin(obj)


class LoginSerializer(TokenObtainPairSerializer):
    """Username + password login for authority staff only. Citizens sign in with phone number + OTP."""

    portal = serializers.ChoiceField(choices=("authority",), default="authority", required=False)

    def validate(self, attrs):
        attrs.pop("portal", None)
        data = super().validate(attrs)
        if not self.user.is_authority:
            raise PermissionDenied(
                detail="Citizens sign in with their mobile number and a one-time code in the CivicEye app.",
                code="wrong_portal",
            )
        data["user"] = UserSerializer(self.user).data
        return data

    def to_internal_value(self, data):
        if isinstance(data, dict) and "username" in data:
            data = {**data, "username": str(data["username"]).lower().strip()}
        return super().to_internal_value(data)


class ProfileUpdateSerializer(serializers.ModelSerializer):
    """Profile edits. Staff may change their username (login) and email; citizens their email.

    Username and email are declared explicitly so they are normalised (trimmed, lowercased) before the
    case-insensitive uniqueness check.
    """

    username = serializers.CharField(max_length=50, required=False, allow_null=True, allow_blank=True)
    email = serializers.EmailField(max_length=254, required=False, allow_null=True, allow_blank=True)

    class Meta:
        model = User
        fields = ("username", "full_name", "email", "phone_number", "preferred_language")

    def validate_username(self, value):
        user = self.instance
        value = (value or "").strip().lower()
        if user is not None and user.is_citizen:
            if value:
                raise serializers.ValidationError("Citizen accounts sign in with their mobile number and have no username.")
            return None
        if not value:
            raise serializers.ValidationError("Your username is your login and can't be empty.")
        username_validator(value)
        if User.objects.filter(username__iexact=value).exclude(pk=getattr(user, "pk", None)).exists():
            raise serializers.ValidationError("This username is already taken.")
        return value

    def validate_email(self, value):
        value = (value or "").strip().lower()
        if not value:
            return None
        if User.objects.filter(email__iexact=value).exclude(pk=getattr(self.instance, "pk", None)).exists():
            raise serializers.ValidationError("This email is already used by another account.")
        return value

    def validate_phone_number(self, value):
        user = self.instance
        if user is not None and user.is_citizen and value != user.phone_number:
            # A citizen's phone number is their login, so it can only change through OTP verification.
            raise serializers.ValidationError("Your mobile number is your login and can't be changed here.")
        return value

    def validate_full_name(self, value):
        value = value.strip()
        if len(value) < 2:
            raise serializers.ValidationError("Enter your full name.")
        return value


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True, trim_whitespace=False)
    new_password = serializers.CharField(write_only=True, trim_whitespace=False)

    def validate_current_password(self, value):
        if not self.context["request"].user.check_password(value):
            raise serializers.ValidationError("Your current password is incorrect.")
        return value

    def validate_new_password(self, value):
        password_validation.validate_password(value, self.context["request"].user)
        return value


class LogoutSerializer(serializers.Serializer):
    refresh = serializers.CharField()


class OTPRequestSerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=24)


class OTPVerifySerializer(serializers.Serializer):
    phone_number = serializers.CharField(max_length=24)
    code = serializers.RegexField(regex=r"^\d{4,8}$", error_messages={"invalid": "Enter the code from the SMS."})
    full_name = serializers.CharField(max_length=150, required=False, allow_blank=True)
