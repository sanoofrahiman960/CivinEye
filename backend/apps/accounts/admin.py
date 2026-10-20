from django import forms
from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin
from django.contrib.auth.forms import UserChangeForm as BaseUserChangeForm

from apps.audit.models import log_action

from .models import AUTHORITY_ROLES, Role, User

FIELD_STAFF = (Role.OFFICER, Role.SUPERVISOR)


def validate_staff_scope(cleaned):
    """Officers and supervisors need a department and at least one service area (their jurisdiction)."""
    role = cleaned.get("role")
    if role in FIELD_STAFF:
        if not cleaned.get("department"):
            raise forms.ValidationError("Officers and supervisors must belong to a department.")
        if not cleaned.get("service_areas"):
            raise forms.ValidationError(
                "Choose at least one service area. Officers only receive issues reported inside their areas "
                "(for example, a Kochi officer only gets issues located in Kochi)."
            )
    if role in AUTHORITY_ROLES and not cleaned.get("username"):
        raise forms.ValidationError("Authority accounts need a username to sign in.")


class UserCreationForm(forms.ModelForm):
    """The administrator creates authority logins here: username + password + role + jurisdiction."""

    password1 = forms.CharField(label="Password", widget=forms.PasswordInput, strip=False)
    password2 = forms.CharField(label="Confirm password", widget=forms.PasswordInput, strip=False)

    class Meta:
        model = User
        fields = ("username", "full_name", "role", "department", "service_areas", "phone_number", "email")

    def clean_username(self):
        username = (self.cleaned_data.get("username") or "").strip().lower()
        return username or None

    def clean(self):
        cleaned = super().clean()
        if cleaned.get("password1") != cleaned.get("password2"):
            raise forms.ValidationError("Passwords do not match.")
        if cleaned.get("role") in AUTHORITY_ROLES and not cleaned.get("password1"):
            raise forms.ValidationError("Set a password for the authority account.")
        validate_staff_scope(cleaned)
        return cleaned

    def save(self, commit=True):
        user = super().save(commit=False)
        if user.role in AUTHORITY_ROLES:
            user.set_password(self.cleaned_data["password1"])
        else:
            user.set_unusable_password()  # citizens sign in with phone + OTP
        if commit:
            user.save()
            self.save_m2m()
        return user


class UserChangeForm(BaseUserChangeForm):
    class Meta(BaseUserChangeForm.Meta):
        model = User
        fields = "__all__"

    def clean_username(self):
        username = (self.cleaned_data.get("username") or "").strip().lower()
        return username or None

    def clean(self):
        cleaned = super().clean()
        validate_staff_scope(cleaned)
        return cleaned


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    """Authority logins (username + password) are created and reset only here, by the administrator.
    Citizens create their own accounts in the app with their mobile number + OTP."""

    add_form = UserCreationForm
    form = UserChangeForm
    ordering = ("username", "phone_number")
    list_display = ("username", "full_name", "role", "department", "areas", "phone_number", "is_active")
    list_filter = ("role", "department", "service_areas", "is_active")
    search_fields = ("username", "full_name", "phone_number", "email")
    filter_horizontal = ("service_areas", "groups", "user_permissions")
    readonly_fields = ("date_joined", "last_login")
    fieldsets = (
        ("Login", {"fields": ("username", "password"), "description": "Use “Reset password” to set a new password for a staff member."}),
        ("Profile", {"fields": ("full_name", "phone_number", "email", "preferred_language")}),
        (
            "Role and jurisdiction",
            {
                "fields": ("role", "department", "service_areas"),
                "description": "Officers and supervisors only see and receive issues located inside their service areas.",
            },
        ),
        ("Access", {"fields": ("is_active", "is_staff", "is_superuser", "groups", "user_permissions")}),
        ("Dates", {"fields": ("date_joined", "last_login")}),
    )
    add_fieldsets = (
        (
            "Login",
            {
                "classes": ("wide",),
                "fields": ("username", "password1", "password2"),
                "description": "Share the username and password with the staff member securely. They can change the password after signing in.",
            },
        ),
        ("Profile", {"classes": ("wide",), "fields": ("full_name", "phone_number", "email")}),
        ("Role and jurisdiction", {"classes": ("wide",), "fields": ("role", "department", "service_areas")}),
    )

    @admin.display(description="Service areas")
    def areas(self, obj):
        return ", ".join(a.name for a in obj.service_areas.all()) or "—"

    def get_queryset(self, request):
        return super().get_queryset(request).select_related("department").prefetch_related("service_areas")

    def save_model(self, request, obj, form, change):
        role_changed = not change or "role" in form.changed_data
        super().save_model(request, obj, form, change)
        if role_changed and obj.role in AUTHORITY_ROLES:
            log_action(request.user, "user.authority_role_granted", obj, {"role": obj.role})
        elif change and "is_active" in form.changed_data:
            log_action(request.user, "user.access_changed", obj, {"is_active": obj.is_active})

    def save_related(self, request, form, formsets, change):
        super().save_related(request, form, formsets, change)
        if "service_areas" in form.changed_data:
            log_action(
                request.user,
                "user.jurisdiction_changed",
                form.instance,
                {"service_areas": [a.code for a in form.instance.service_areas.all()]},
            )
