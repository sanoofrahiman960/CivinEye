from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class Priority(models.TextChoices):
    CRITICAL = "CRITICAL", "Critical"
    HIGH = "HIGH", "High"
    MEDIUM = "MEDIUM", "Medium"
    LOW = "LOW", "Low"
    UNCLASSIFIED = "UNCLASSIFIED", "Unclassified"


# Higher number = more urgent. Used for sorting and rule-based bumps.
PRIORITY_RANK = {
    Priority.UNCLASSIFIED: 0,
    Priority.LOW: 1,
    Priority.MEDIUM: 2,
    Priority.HIGH: 3,
    Priority.CRITICAL: 4,
}
RANKED_PRIORITIES = [Priority.LOW, Priority.MEDIUM, Priority.HIGH, Priority.CRITICAL]


class Status(models.TextChoices):
    SUBMITTED = "SUBMITTED", "Submitted"
    ACKNOWLEDGED = "ACKNOWLEDGED", "Acknowledged"
    IN_PROGRESS = "IN_PROGRESS", "In Progress"
    RESOLVED = "RESOLVED", "Resolved — Awaiting Citizen Verification"
    CLOSED = "CLOSED", "Closed"
    REOPENED = "REOPENED", "Reopened"


ACTIVE_STATUSES = (Status.SUBMITTED, Status.ACKNOWLEDGED, Status.IN_PROGRESS, Status.REOPENED)


class ClosureType(models.TextChoices):
    CITIZEN_CONFIRMED = "CITIZEN_CONFIRMED", "Confirmed fixed by the reporter"
    AUTO_TIMEOUT = "AUTO_TIMEOUT", "Closed automatically after the verification period"
    ADMIN_CLOSED = "ADMIN_CLOSED", "Closed by an administrator"


class IssueCategory(models.Model):
    name = models.CharField(max_length=100, unique=True)
    slug = models.SlugField(max_length=60, unique=True)
    description = models.TextField(blank=True)
    icon = models.CharField(max_length=50, default="alert-circle-outline", help_text="Ionicons icon name.")
    default_department = models.ForeignKey(
        "departments.Department", null=True, blank=True, on_delete=models.SET_NULL, related_name="categories"
    )
    default_priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.MEDIUM)
    sla_ack_hours = models.PositiveIntegerField(default=48)
    sla_resolve_hours = models.PositiveIntegerField(default=168)
    is_life_threatening = models.BooleanField(
        default=False, help_text="Show emergency numbers first and alert officers immediately."
    )
    durability_check_days = models.PositiveIntegerField(
        default=30, help_text="Days after closure to ask whether the fix lasted. 0 disables the check."
    )
    display_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["display_order", "name"]
        verbose_name_plural = "issue categories"

    def __str__(self):
        return self.name


class IssueSubcategory(models.Model):
    category = models.ForeignKey(IssueCategory, on_delete=models.CASCADE, related_name="subcategories")
    name = models.CharField(max_length=100)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]
        verbose_name_plural = "issue subcategories"
        constraints = [models.UniqueConstraint(fields=["category", "name"], name="unique_subcategory_per_category")]

    def __str__(self):
        return f"{self.category.name} / {self.name}"


class EmergencyContact(models.Model):
    name = models.CharField(max_length=100)
    phone_number = models.CharField(max_length=20)
    service_area = models.ForeignKey(
        "departments.ServiceArea", null=True, blank=True, on_delete=models.CASCADE, related_name="emergency_contacts",
        help_text="Leave empty to show in every area.",
    )
    category = models.ForeignKey(
        IssueCategory, null=True, blank=True, on_delete=models.CASCADE, related_name="emergency_contacts",
        help_text="Leave empty to show for every life-threatening category.",
    )
    display_order = models.PositiveIntegerField(default=0)
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["display_order", "name"]

    def __str__(self):
        return f"{self.name} ({self.phone_number})"


class Issue(models.Model):
    complaint_id = models.CharField(max_length=20, unique=True, null=True, editable=False)
    reporter = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="reported_issues")

    title = models.CharField(max_length=150)
    description = models.TextField()
    additional_details = models.TextField(blank=True)
    category = models.ForeignKey(IssueCategory, on_delete=models.PROTECT, related_name="issues")
    subcategory = models.ForeignKey(
        IssueSubcategory, null=True, blank=True, on_delete=models.SET_NULL, related_name="issues"
    )

    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    location_accuracy_m = models.FloatField(null=True, blank=True)
    address = models.CharField(max_length=255, blank=True)
    service_area = models.ForeignKey(
        "departments.ServiceArea", null=True, blank=True, on_delete=models.SET_NULL, related_name="issues"
    )

    reported_urgency = models.CharField(
        max_length=20, choices=Priority.choices, blank=True, help_text="The citizen's perceived urgency (a signal only)."
    )
    recommended_priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.UNCLASSIFIED)
    priority = models.CharField(max_length=20, choices=Priority.choices, default=Priority.UNCLASSIFIED)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SUBMITTED)
    closure_type = models.CharField(max_length=30, choices=ClosureType.choices, blank=True)

    department = models.ForeignKey(
        "departments.Department", null=True, blank=True, on_delete=models.PROTECT, related_name="issues"
    )
    assigned_officer = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="assigned_issues"
    )

    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)
    started_at = models.DateTimeField(null=True, blank=True)
    resolved_at = models.DateTimeField(null=True, blank=True)
    closed_at = models.DateTimeField(null=True, blank=True)
    reopened_at = models.DateTimeField(null=True, blank=True)
    ack_due_at = models.DateTimeField(null=True, blank=True)
    due_at = models.DateTimeField(null=True, blank=True)
    is_overdue = models.BooleanField(default=False)

    resolution_description = models.TextField(blank=True)
    resolution_cycle = models.PositiveIntegerField(
        default=1, help_text="Incremented on every reopen; resolution evidence belongs to one cycle."
    )
    reopen_count = models.PositiveIntegerField(default=0)
    impact_count = models.PositiveIntegerField(default=0, help_text="Number of citizens who said this affects them too.")

    satisfaction_rating = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    satisfaction_comment = models.TextField(blank=True)

    parent_issue = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="recurrences"
    )
    is_recurrence = models.BooleanField(default=False)

    client_submission_id = models.UUIDField(null=True, blank=True, help_text="Idempotency key sent by the app.")
    client_reported_at = models.DateTimeField(null=True, blank=True, help_text="When the report was captured on the device.")

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["status"]),
            models.Index(fields=["priority"]),
            models.Index(fields=["department", "status"]),
            models.Index(fields=["reporter", "-created_at"]),
            models.Index(fields=["category", "status"]),
            models.Index(fields=["latitude", "longitude"]),
            models.Index(fields=["is_overdue"]),
            models.Index(fields=["created_at"]),
            models.Index(fields=["due_at"]),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["reporter", "client_submission_id"],
                condition=models.Q(client_submission_id__isnull=False),
                name="unique_client_submission_per_reporter",
            ),
            models.CheckConstraint(
                condition=models.Q(latitude__gte=-90, latitude__lte=90)
                & models.Q(longitude__gte=-180, longitude__lte=180),
                name="issue_valid_coordinates",
            ),
            models.CheckConstraint(
                condition=models.Q(satisfaction_rating__isnull=True)
                | models.Q(satisfaction_rating__gte=1, satisfaction_rating__lte=5),
                name="issue_satisfaction_range",
            ),
        ]

    def __str__(self):
        return f"{self.complaint_id or 'new'}: {self.title}"

    def compute_overdue(self, now=None):
        now = now or timezone.now()
        if self.status not in ACTIVE_STATUSES:
            return False
        if self.due_at and now > self.due_at:
            return True
        if self.status in (Status.SUBMITTED, Status.REOPENED) and self.ack_due_at and now > self.ack_due_at:
            return True
        return False

    @property
    def days_open(self):
        end = self.closed_at or timezone.now()
        return max((end - self.created_at).days, 0)


def issue_image_path(instance, filename):
    return f"issues/{timezone.now():%Y/%m}/{filename}"


class ImageType(models.TextChoices):
    REPORT = "REPORT", "Report"
    ADDITIONAL_EVIDENCE = "ADDITIONAL_EVIDENCE", "Additional evidence"
    RESOLUTION = "RESOLUTION", "Resolution"
    REOPEN_EVIDENCE = "REOPEN_EVIDENCE", "Reopen evidence"
    DURABILITY_EVIDENCE = "DURABILITY_EVIDENCE", "Durability follow-up evidence"


class CaptureSource(models.TextChoices):
    CAMERA = "CAMERA", "In-app camera"
    GALLERY = "GALLERY", "Gallery"
    UNKNOWN = "UNKNOWN", "Unknown"


class ProofCheckStatus(models.TextChoices):
    NOT_APPLICABLE = "NOT_APPLICABLE", "Not applicable"
    PASSED = "PASSED", "Passed"
    FLAGGED = "FLAGGED", "Flagged"
    OVERRIDDEN = "OVERRIDDEN", "Overridden by supervisor"


class IssueImage(models.Model):
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to=issue_image_path)
    thumbnail = models.ImageField(upload_to=issue_image_path, blank=True)
    image_type = models.CharField(max_length=30, choices=ImageType.choices)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="uploaded_images")
    uploaded_at = models.DateTimeField(auto_now_add=True)
    caption = models.CharField(max_length=255, blank=True)
    resolution_cycle = models.PositiveIntegerField(default=1)

    # Proof-Lock capture metadata (resolution photos).
    capture_source = models.CharField(max_length=10, choices=CaptureSource.choices, default=CaptureSource.UNKNOWN)
    capture_latitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    capture_longitude = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    capture_accuracy_m = models.FloatField(null=True, blank=True)
    captured_at = models.DateTimeField(null=True, blank=True)
    distance_from_issue_m = models.FloatField(null=True, blank=True)
    perceptual_hash = models.CharField(max_length=16, blank=True, db_index=True)
    proof_check_status = models.CharField(
        max_length=20, choices=ProofCheckStatus.choices, default=ProofCheckStatus.NOT_APPLICABLE
    )
    proof_check_notes = models.CharField(max_length=255, blank=True)
    override_reason = models.TextField(blank=True)
    overridden_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    overridden_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["uploaded_at"]
        indexes = [models.Index(fields=["issue", "image_type", "resolution_cycle"])]

    def __str__(self):
        return f"{self.get_image_type_display()} image for {self.issue_id}"


class IssueHistory(models.Model):
    """One row per status transition. Rows are never updated or deleted."""

    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="history")
    previous_status = models.CharField(max_length=20, choices=Status.choices, blank=True)
    new_status = models.CharField(max_length=20, choices=Status.choices)
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+",
        help_text="Empty when the change was made by the system.",
    )
    reason = models.TextField(blank=True)
    closure_type = models.CharField(max_length=30, choices=ClosureType.choices, blank=True)
    evidence = models.ManyToManyField(IssueImage, blank=True, related_name="history_entries")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        verbose_name_plural = "issue history"

    def __str__(self):
        return f"{self.issue_id}: {self.previous_status or '—'} → {self.new_status}"


class IssuePriorityChange(models.Model):
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="priority_changes")
    previous_priority = models.CharField(max_length=20, choices=Priority.choices)
    new_priority = models.CharField(max_length=20, choices=Priority.choices)
    changed_by = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="+")
    reason = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]


class CommentVisibility(models.TextChoices):
    CITIZEN_VISIBLE = "CITIZEN_VISIBLE", "Visible to citizen"
    INTERNAL = "INTERNAL", "Internal (authority only)"


class IssueComment(models.Model):
    issue = models.ForeignKey(Issue, on_delete=models.CASCADE, related_name="comments")
    author = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="issue_comments")
    comment = models.TextField()
    visibility = models.CharField(max_length=20, choices=CommentVisibility.choices, default=CommentVisibility.CITIZEN_VISIBLE)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["created_at", "id"]
        indexes = [models.Index(fields=["issue", "visibility"])]
