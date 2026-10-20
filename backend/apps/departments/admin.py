from django import forms
from django.contrib import admin

from .models import Department, ServiceArea

BOX_FIELDS = ("min_latitude", "max_latitude", "min_longitude", "max_longitude")


class ServiceAreaForm(forms.ModelForm):
    class Meta:
        model = ServiceArea
        fields = "__all__"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        # With a boundary polygon the box is derived automatically, so the box fields become optional.
        for name in BOX_FIELDS:
            self.fields[name].required = False

    def clean(self):
        cleaned = super().clean()
        if not cleaned.get("boundary") and any(cleaned.get(name) is None for name in BOX_FIELDS):
            raise forms.ValidationError("Enter either a boundary polygon or all four bounding-box coordinates.")
        if cleaned.get("boundary"):
            # Placeholders; ServiceArea.clean() replaces them with the polygon's real extent.
            for name in BOX_FIELDS:
                if cleaned.get(name) is None:
                    cleaned[name] = 0
                    setattr(self.instance, name, 0)
        return cleaned


@admin.register(ServiceArea)
class ServiceAreaAdmin(admin.ModelAdmin):
    """Jurisdictions. Issues located inside an area go only to officers assigned to that area."""

    form = ServiceAreaForm
    list_display = ("tree_name", "level", "code", "has_boundary", "officer_count", "is_active")
    list_filter = ("level", "is_active")
    search_fields = ("name", "code")
    ordering = ("path",)
    autocomplete_fields = ("parent",)
    prepopulated_fields = {"code": ("name",)}
    fieldsets = (
        (None, {"fields": ("name", "code", "level", "parent", "description", "is_active")}),
        (
            "Boundary",
            {
                "fields": ("boundary", *BOX_FIELDS),
                "description": "Paste the exact boundary (GeoJSON Polygon coordinates, [lng, lat] order) for accurate "
                "routing, or just a bounding box. The box is calculated from the boundary when one is given.",
            },
        ),
    )

    @admin.display(description="Area", ordering="path")
    def tree_name(self, obj):
        return f"{'— ' * obj.depth}{obj.name}"

    @admin.display(boolean=True, description="Exact boundary")
    def has_boundary(self, obj):
        return bool(obj.boundary)

    @admin.display(description="Staff")
    def officer_count(self, obj):
        return obj.officers.filter(is_active=True).count()


@admin.register(Department)
class DepartmentAdmin(admin.ModelAdmin):
    list_display = ("name", "code", "contact_email", "allow_gallery_resolution", "allow_resolution_without_evidence", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name", "code")
    filter_horizontal = ("service_areas",)
    prepopulated_fields = {"code": ("name",)}
