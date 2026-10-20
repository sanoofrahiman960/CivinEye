from django.contrib import admin

from apps.audit.models import log_action

from .models import DEFAULT_FEATURE_FLAGS, FeatureFlag, PlatformConfiguration


@admin.register(FeatureFlag)
class FeatureFlagAdmin(admin.ModelAdmin):
    list_display = ("key", "is_enabled", "updated_by", "updated_at")
    list_editable = ("is_enabled",)
    readonly_fields = ("updated_by", "updated_at")

    def save_model(self, request, obj, form, change):
        obj.updated_by = request.user
        if not obj.description:
            obj.description = DEFAULT_FEATURE_FLAGS[obj.key]["description"]
        super().save_model(request, obj, form, change)
        log_action(request.user, "feature_flag.changed", obj, {"key": obj.key, "enabled": obj.is_enabled, "config": obj.config})


@admin.register(PlatformConfiguration)
class PlatformConfigurationAdmin(admin.ModelAdmin):
    list_display = ("__str__", "verification_timeout_days", "citizen_reopen_window_days", "updated_at")

    def has_add_permission(self, request):
        return not PlatformConfiguration.objects.exists()

    def has_delete_permission(self, request, obj=None):
        return False

    def save_model(self, request, obj, form, change):
        super().save_model(request, obj, form, change)
        log_action(request.user, "platform_configuration.changed", obj, {"fields": list(form.changed_data)})
