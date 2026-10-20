from django.conf import settings
from django.db import models


class IssueAssignment(models.Model):
    """Every assignment is kept; `is_current` marks the latest one for an issue."""

    issue = models.ForeignKey("issues.Issue", on_delete=models.CASCADE, related_name="assignments")
    department = models.ForeignKey("departments.Department", on_delete=models.PROTECT, related_name="assignments")
    assigned_officer = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="officer_assignments"
    )
    assigned_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="assignments_made",
        help_text="Empty when the system routed the issue automatically.",
    )
    assigned_at = models.DateTimeField(auto_now_add=True)
    notes = models.TextField(blank=True)
    is_current = models.BooleanField(default=True)

    class Meta:
        ordering = ["-assigned_at", "-id"]
        indexes = [models.Index(fields=["issue", "is_current"])]

    def __str__(self):
        return f"{self.issue_id} → {self.department}"
