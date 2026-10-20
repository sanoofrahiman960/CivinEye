from django.contrib import admin

from .models import DeviceToken, Notification


@admin.register(Notification)
class NotificationAdmin(admin.ModelAdmin):
    list_display = ("created_at", "recipient", "notification_type", "title", "is_read")
    list_filter = ("notification_type", "is_read")
    search_fields = ("recipient__email", "title")
    raw_id_fields = ("recipient", "issue")


@admin.register(DeviceToken)
class DeviceTokenAdmin(admin.ModelAdmin):
    list_display = ("user", "platform", "is_active", "last_seen_at")
    list_filter = ("platform", "is_active")
    raw_id_fields = ("user",)
