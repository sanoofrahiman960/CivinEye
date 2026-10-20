from django.contrib import admin

from .models import IssueAssignment


@admin.register(IssueAssignment)
class IssueAssignmentAdmin(admin.ModelAdmin):
    list_display = ("issue", "department", "assigned_officer", "assigned_by", "assigned_at", "is_current")
    list_filter = ("department", "is_current")
    raw_id_fields = ("issue", "assigned_officer", "assigned_by")

    def has_change_permission(self, request, obj=None):
        return False
