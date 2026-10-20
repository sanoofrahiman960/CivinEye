from django.conf import settings
from django.db import models


class NotificationType(models.TextChoices):
    ISSUE_SUBMITTED = "ISSUE_SUBMITTED", "Complaint submitted"
    NEW_ISSUE = "NEW_ISSUE", "New issue for your department"
    LIFE_SAFETY_ALERT = "LIFE_SAFETY_ALERT", "Life-safety alert"
    ISSUE_ACKNOWLEDGED = "ISSUE_ACKNOWLEDGED", "Issue acknowledged"
    ISSUE_ASSIGNED = "ISSUE_ASSIGNED", "Department assigned"
    WORK_STARTED = "WORK_STARTED", "Work started"
    VERIFICATION_REQUESTED = "VERIFICATION_REQUESTED", "Resolution evidence uploaded — please verify"
    ISSUE_REOPENED = "ISSUE_REOPENED", "Issue reopened"
    ISSUE_CLOSED = "ISSUE_CLOSED", "Complaint closed"
    SLA_BREACH = "SLA_BREACH", "SLA breach"
    PRIORITY_CHANGED = "PRIORITY_CHANGED", "Priority changed"
    NEW_COMMENT = "NEW_COMMENT", "New update"
    DURABILITY_CHECK = "DURABILITY_CHECK", "Is it still fixed?"
    RECURRENCE_REPORTED = "RECURRENCE_REPORTED", "Problem returned"


class Notification(models.Model):
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="notifications")
    issue = models.ForeignKey("issues.Issue", null=True, blank=True, on_delete=models.CASCADE, related_name="notifications")
    title = models.CharField(max_length=150)
    message = models.TextField()
    notification_type = models.CharField(max_length=40, choices=NotificationType.choices)
    is_read = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    # Same event + same recipient → same key, so retries never create duplicate alerts.
    dedupe_key = models.CharField(max_length=200, unique=True, null=True, blank=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        indexes = [models.Index(fields=["recipient", "is_read", "-created_at"])]

    def __str__(self):
        return f"{self.recipient_id}: {self.title}"


class DeviceToken(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="device_tokens")
    token = models.CharField(max_length=255, unique=True)
    platform = models.CharField(max_length=20, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    last_seen_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"{self.user_id} ({self.platform})"
