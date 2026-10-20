from django.conf import settings
from django.db import models

# Default state for every feature flag. A missing database row falls back to these values,
# and the `config` stored in the database is merged over the defaults key by key.
DEFAULT_FEATURE_FLAGS = {
    "proof_lock": {
        "enabled": True,
        "description": "Resolution photos must be taken in-app near the issue location and must not reuse earlier images.",
        "config": {"max_distance_m": 50, "max_accuracy_m": 30, "hash_threshold": 5},
    },
    "durability_check": {
        "enabled": True,
        "description": "Ask reporters and supporters whether a closed issue is still fixed.",
        "config": {"response_window_days": 14},
    },
    "affects_me_too": {
        "enabled": True,
        "description": "Citizens can support an existing nearby issue instead of filing a duplicate.",
        "config": {"max_distance_m": 2000, "impact_bump_threshold": 10},
    },
    "duplicate_detection": {
        "enabled": True,
        "description": "Suggest nearby open issues in the same category before a new report is submitted.",
        "config": {"radius_m": 150, "window_days": 30},
    },
    "offline_queue": {
        "enabled": True,
        "description": "Reports captured offline are accepted later with their original capture time.",
        "config": {"max_age_hours": 72},
    },
    "life_safety": {
        "enabled": True,
        "description": "Life-threatening categories show emergency numbers first and alert officers immediately.",
        "config": {"ack_sla_hours": 1},
    },
}


class FeatureFlag(models.Model):
    KEY_CHOICES = [(key, key.replace("_", " ").title()) for key in DEFAULT_FEATURE_FLAGS]

    key = models.CharField(max_length=50, unique=True, choices=KEY_CHOICES)
    is_enabled = models.BooleanField(default=True)
    config = models.JSONField(default=dict, blank=True)
    description = models.TextField(blank=True)
    updated_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+"
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["key"]

    def __str__(self):
        return f"{self.key} ({'on' if self.is_enabled else 'off'})"


class Flag:
    """Resolved feature flag: enabled state plus merged configuration."""

    def __init__(self, key, enabled, config):
        self.key = key
        self.enabled = enabled
        self.config = config

    def __bool__(self):
        return self.enabled

    def get(self, name, default=None):
        return self.config.get(name, default)


def get_flag(key):
    defaults = DEFAULT_FEATURE_FLAGS[key]
    row = FeatureFlag.objects.filter(key=key).first()
    config = dict(defaults["config"])
    if row is None:
        return Flag(key, defaults["enabled"], config)
    config.update(row.config or {})
    return Flag(key, row.is_enabled, config)


def all_flags():
    return {key: get_flag(key) for key in DEFAULT_FEATURE_FLAGS}


def default_priority_sla_hours():
    return {"CRITICAL": 24, "HIGH": 72, "MEDIUM": 168, "LOW": 336}


class PlatformConfiguration(models.Model):
    """Singleton holding platform-wide policies, editable in Django admin."""

    verification_timeout_days = models.PositiveIntegerField(
        default=7, help_text="Days a resolved issue waits for citizen verification before the timeout policy applies."
    )
    auto_close_on_verification_timeout = models.BooleanField(
        default=True,
        help_text="If on, unverified resolved issues close as AUTO_TIMEOUT after the timeout. "
        "This is recorded separately and never reported as citizen-confirmed.",
    )
    citizen_reopen_window_days = models.PositiveIntegerField(
        default=14, help_text="Days after closure during which the reporter may still reopen an issue."
    )
    max_images_per_upload = models.PositiveIntegerField(default=5)
    auto_apply_priority_rules = models.BooleanField(
        default=True, help_text="Apply the rule-based priority recommendation as the initial official priority."
    )
    priority_sla_hours = models.JSONField(
        default=default_priority_sla_hours,
        help_text="Maximum resolution hours per priority. The stricter of this and the category SLA applies.",
    )
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        verbose_name = "Platform configuration"
        verbose_name_plural = "Platform configuration"

    def __str__(self):
        return "Platform configuration"

    def save(self, *args, **kwargs):
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj
