from django.conf import settings
from django.db import models


class IssueSupport(models.Model):
    """A citizen saying 'this affects me too' about someone else's issue."""

    issue = models.ForeignKey("issues.Issue", on_delete=models.CASCADE, related_name="supports")
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="issue_supports")
    note = models.CharField(max_length=500, blank=True)
    latitude = models.DecimalField(max_digits=9, decimal_places=6)
    longitude = models.DecimalField(max_digits=9, decimal_places=6)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-created_at"]
        constraints = [models.UniqueConstraint(fields=["issue", "user"], name="one_support_per_user_per_issue")]


class DurabilityResponse(models.TextChoices):
    PENDING = "PENDING", "Pending"
    STILL_FIXED = "STILL_FIXED", "Still fixed"
    PROBLEM_RETURNED = "PROBLEM_RETURNED", "Problem returned"
    NO_RESPONSE = "NO_RESPONSE", "No response"
    CANCELLED = "CANCELLED", "Cancelled"


class DurabilityCheck(models.Model):
    """'Is it still fixed?' follow-up sent some days after an issue closes."""

    issue = models.ForeignKey("issues.Issue", on_delete=models.CASCADE, related_name="durability_checks")
    recipient = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="durability_checks")
    due_at = models.DateTimeField()
    sent_at = models.DateTimeField(null=True, blank=True)
    response = models.CharField(max_length=20, choices=DurabilityResponse.choices, default=DurabilityResponse.PENDING)
    responded_at = models.DateTimeField(null=True, blank=True)
    note = models.CharField(max_length=500, blank=True)
    follow_up_issue = models.ForeignKey(
        "issues.Issue", null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["due_at"]
        constraints = [models.UniqueConstraint(fields=["issue", "recipient"], name="one_durability_check_per_recipient")]
        indexes = [models.Index(fields=["response", "due_at"])]
