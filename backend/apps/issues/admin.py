from django.contrib import admin

from .models import (
    EmergencyContact,
    Issue,
    IssueCategory,
    IssueComment,
    IssueHistory,
    IssueImage,
    IssuePriorityChange,
    IssueSubcategory,
)


class SubcategoryInline(admin.TabularInline):
    model = IssueSubcategory
    extra = 1


@admin.register(IssueCategory)
class IssueCategoryAdmin(admin.ModelAdmin):
    list_display = (
        "name",
        "default_department",
        "default_priority",
        "sla_ack_hours",
        "sla_resolve_hours",
        "is_life_threatening",
        "durability_check_days",
        "is_active",
    )
    list_filter = ("is_active", "is_life_threatening", "default_department")
    search_fields = ("name", "slug")
    prepopulated_fields = {"slug": ("name",)}
    inlines = [SubcategoryInline]


@admin.register(EmergencyContact)
class EmergencyContactAdmin(admin.ModelAdmin):
    list_display = ("name", "phone_number", "service_area", "category", "display_order", "is_active")
    list_filter = ("is_active", "service_area", "category")


class ReadOnlyInline(admin.TabularInline):
    extra = 0
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False

    def has_change_permission(self, request, obj=None):
        return False


class ImageInline(ReadOnlyInline):
    model = IssueImage
    fields = ("image_type", "image", "uploaded_by", "uploaded_at", "resolution_cycle", "proof_check_status", "distance_from_issue_m")
    readonly_fields = fields


class HistoryInline(ReadOnlyInline):
    model = IssueHistory
    fields = ("created_at", "previous_status", "new_status", "changed_by", "closure_type", "reason")
    readonly_fields = fields


class PriorityChangeInline(ReadOnlyInline):
    model = IssuePriorityChange
    fields = ("created_at", "previous_priority", "new_priority", "changed_by", "reason")
    readonly_fields = fields


class CommentInline(ReadOnlyInline):
    model = IssueComment
    fields = ("created_at", "author", "visibility", "comment")
    readonly_fields = fields


@admin.register(Issue)
class IssueAdmin(admin.ModelAdmin):
    """Read-mostly: status changes must go through the API so history and notifications stay consistent."""

    list_display = ("complaint_id", "title", "category", "status", "priority", "department", "assigned_officer", "created_at", "is_overdue")
    list_filter = ("status", "priority", "category", "department", "is_overdue", "closure_type")
    search_fields = ("complaint_id", "title", "address", "reporter__email")
    date_hierarchy = "created_at"
    raw_id_fields = ("reporter", "assigned_officer", "parent_issue")
    readonly_fields = [f.name for f in Issue._meta.fields]
    inlines = [ImageInline, HistoryInline, PriorityChangeInline, CommentInline]

    def has_add_permission(self, request):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
