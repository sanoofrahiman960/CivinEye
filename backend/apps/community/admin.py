from django.contrib import admin

from .models import DurabilityCheck, IssueSupport


@admin.register(IssueSupport)
class IssueSupportAdmin(admin.ModelAdmin):
    list_display = ("issue", "user", "created_at")
    raw_id_fields = ("issue", "user")


@admin.register(DurabilityCheck)
class DurabilityCheckAdmin(admin.ModelAdmin):
    list_display = ("issue", "recipient", "due_at", "sent_at", "response", "responded_at", "follow_up_issue")
    list_filter = ("response",)
    raw_id_fields = ("issue", "recipient", "follow_up_issue")
