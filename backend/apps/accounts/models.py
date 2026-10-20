from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.core.validators import RegexValidator
from django.db import models
from django.utils import timezone

phone_validator = RegexValidator(
    regex=r"^\+?[0-9]{7,15}$", message="Enter a valid phone number (7–15 digits, optional leading +)."
)
username_validator = RegexValidator(
    regex=r"^[a-z0-9][a-z0-9._-]{2,49}$",
    message="Use 3–50 lowercase letters, digits, dots, hyphens or underscores.",
)


class Role(models.TextChoices):
    CITIZEN = "CITIZEN", "Citizen"
    OFFICER = "OFFICER", "Department officer"
    SUPERVISOR = "SUPERVISOR", "Department supervisor"
    ADMIN = "ADMIN", "System administrator"


AUTHORITY_ROLES = (Role.OFFICER, Role.SUPERVISOR, Role.ADMIN)


class UserManager(BaseUserManager):
    use_in_migrations = True

    def _create_user(self, username, password, **extra):
        """Authority staff get a username + password (set up by the administrator).
        Citizens have neither: they sign in with phone number + OTP."""
        username = username.strip().lower() if username else None
        if username is None and extra.get("role", Role.CITIZEN) != Role.CITIZEN:
            raise ValueError("Authority accounts need a username.")
        email = extra.pop("email", None)
        user = self.model(username=username, email=self.normalize_email(email).lower() if email else None, **extra)
        user.set_password(password)
        user.full_clean(exclude=["password"])
        user.save(using=self._db)
        return user

    def create_user(self, username=None, password=None, **extra):
        extra.setdefault("role", Role.CITIZEN)
        extra.setdefault("is_staff", False)
        extra.setdefault("is_superuser", False)
        return self._create_user(username, password, **extra)

    def create_superuser(self, username, password=None, **extra):
        extra.setdefault("role", Role.ADMIN)
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self._create_user(username, password, **extra)


class User(AbstractBaseUser, PermissionsMixin):
    """Citizens sign in with phone number + OTP and have no password.
    Authority staff sign in with a username + password created by the administrator."""

    username = models.CharField(
        max_length=50,
        unique=True,
        null=True,
        blank=True,
        validators=[username_validator],
        help_text="Login name for authority staff (lowercase). Citizens have none: they use their mobile number.",
    )
    full_name = models.CharField(max_length=150)
    email = models.EmailField(unique=True, null=True, blank=True)
    phone_number = models.CharField(max_length=16, blank=True, validators=[phone_validator])
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.CITIZEN, db_index=True)
    department = models.ForeignKey(
        "departments.Department", null=True, blank=True, on_delete=models.PROTECT, related_name="staff"
    )
    service_areas = models.ManyToManyField(
        "departments.ServiceArea",
        blank=True,
        related_name="officers",
        help_text="Limit an officer to these areas. Leave empty for every area of the department.",
    )
    preferred_language = models.CharField(max_length=10, default="en")
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    date_joined = models.DateTimeField(default=timezone.now)

    objects = UserManager()

    USERNAME_FIELD = "username"
    EMAIL_FIELD = "email"
    REQUIRED_FIELDS = ["full_name"]

    class Meta:
        ordering = ["full_name"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(role__in=["CITIZEN", "ADMIN"]) | models.Q(department__isnull=False),
                name="authority_staff_requires_department",
            ),
            models.CheckConstraint(
                condition=models.Q(role="CITIZEN") | models.Q(username__isnull=False),
                name="authority_staff_requires_username",
            ),
            # A phone number identifies exactly one citizen account (it is their login).
            models.UniqueConstraint(
                fields=["phone_number"],
                condition=models.Q(role="CITIZEN") & ~models.Q(phone_number=""),
                name="unique_citizen_phone",
            ),
        ]

    def __str__(self):
        return f"{self.full_name} ({self.username or self.phone_number})"

    def clean(self):
        self.username = self.username.strip().lower() if self.username else None
        self.email = self.email.strip().lower() if self.email else None
        super().clean()

    @property
    def is_citizen(self):
        return self.role == Role.CITIZEN

    @property
    def is_authority(self):
        return self.role in AUTHORITY_ROLES

    @property
    def is_supervisor_or_admin(self):
        return self.role in (Role.SUPERVISOR, Role.ADMIN)

    @property
    def is_platform_admin(self):
        return self.role == Role.ADMIN


class PhoneOTP(models.Model):
    """One-time sign-in code sent by SMS. Only a hash of the code is stored."""

    phone_number = models.CharField(max_length=16, db_index=True)
    code_hash = models.CharField(max_length=128)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    expires_at = models.DateTimeField()
    attempts = models.PositiveSmallIntegerField(default=0)
    consumed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "phone OTP"

    def __str__(self):
        return f"OTP for {self.phone_number} at {self.created_at:%Y-%m-%d %H:%M}"
