from decimal import Decimal

from django.core.exceptions import ValidationError
from django.db import models


def _point_in_ring(lat, lng, ring):
    """Ray casting test; `ring` is a list of [lng, lat] pairs (GeoJSON order)."""
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = float(ring[i][0]), float(ring[i][1])
        xj, yj = float(ring[j][0]), float(ring[j][1])
        if (yi > lat) != (yj > lat) and lng < (xj - xi) * (lat - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _as_polygons(boundary):
    """GeoJSON Polygon coordinates ([[[lng, lat], ...], hole...]) or MultiPolygon ([[[[lng, lat], ...]]]) -> polygons."""
    if not isinstance(boundary, list) or not boundary:
        return None
    try:
        is_multi = isinstance(boundary[0][0][0], list)
    except (IndexError, TypeError):
        return None
    polygons = boundary if is_multi else [boundary]
    for polygon in polygons:
        if not (isinstance(polygon, list) and polygon):
            return None
        for ring in polygon:
            if not (isinstance(ring, list) and len(ring) >= 4 and all(isinstance(pt, list) and len(pt) >= 2 for pt in ring)):
                return None
    return polygons


class AreaLevel(models.TextChoices):
    STATE = "STATE", "State"
    DISTRICT = "DISTRICT", "District"
    TALUK = "TALUK", "Taluk"
    GRAMA_PANCHAYAT = "GRAMA_PANCHAYAT", "Grama Panchayat"
    MUNICIPALITY = "MUNICIPALITY", "Municipality"
    CORPORATION = "CORPORATION", "Municipal Corporation"
    WARD = "WARD", "Ward"
    OTHER = "OTHER", "Other"


# Lower rank = higher in the hierarchy. A child must have a higher rank than its parent.
# Municipalities and corporations may sit directly under a district (as in Kerala) or under a taluk.
LEVEL_RANK = {
    AreaLevel.STATE: 0,
    AreaLevel.DISTRICT: 1,
    AreaLevel.TALUK: 2,
    AreaLevel.GRAMA_PANCHAYAT: 3,
    AreaLevel.MUNICIPALITY: 3,
    AreaLevel.CORPORATION: 3,
    AreaLevel.OTHER: 3,
    AreaLevel.WARD: 4,
}


class ServiceArea(models.Model):
    """A jurisdiction in a tree: State → District → Taluk → Panchayat / Municipality / Corporation → Ward.

    Staff assigned to an area handle issues located in it and in every area below it. Issues are placed
    in the deepest area containing their location. The area is a bounding box, optionally refined by an
    exact `boundary` polygon (the box is then derived from the polygon).
    """

    name = models.CharField(max_length=120)
    code = models.SlugField(max_length=60, unique=True)
    level = models.CharField(max_length=20, choices=AreaLevel.choices, default=AreaLevel.OTHER, db_index=True)
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.PROTECT, related_name="children",
        help_text="The area this one belongs to, e.g. the district of a taluk.",
    )
    # Materialised path of ids ("/1/5/12/") so "this area and everything under it" is one prefix query.
    path = models.CharField(max_length=255, blank=True, db_index=True, editable=False)
    description = models.TextField(blank=True)
    min_latitude = models.DecimalField(max_digits=9, decimal_places=6)
    max_latitude = models.DecimalField(max_digits=9, decimal_places=6)
    min_longitude = models.DecimalField(max_digits=9, decimal_places=6)
    max_longitude = models.DecimalField(max_digits=9, decimal_places=6)
    boundary = models.JSONField(
        null=True,
        blank=True,
        help_text="Optional exact boundary: the \"coordinates\" of a GeoJSON Polygon or MultiPolygon ([lng, lat] order).",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["path", "name"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(min_latitude__lte=models.F("max_latitude"))
                & models.Q(min_longitude__lte=models.F("max_longitude")),
                name="service_area_valid_bounds",
            ),
            models.UniqueConstraint(fields=["parent", "name"], name="unique_area_name_per_parent"),
        ]

    def __str__(self):
        return f"{self.name} ({self.get_level_display()})"

    @property
    def rank(self):
        return LEVEL_RANK.get(self.level, 3)

    @property
    def depth(self):
        return max(self.path.count("/") - 2, 0)

    def ancestor_ids(self):
        """Ids from the root down to (and including) this area, parsed from the path."""
        return [int(part) for part in self.path.strip("/").split("/") if part]

    def descendants_and_self(self):
        return ServiceArea.objects.filter(path__startswith=self.path)

    def clean(self):
        super().clean()
        if self.parent_id:
            if self.pk and self.parent_id == self.pk:
                raise ValidationError({"parent": "An area cannot be its own parent."})
            if self.pk and self.parent.path.startswith(self.path or f"/{self.pk}/"):
                raise ValidationError({"parent": "An area cannot be placed inside one of its own sub-areas."})
            if LEVEL_RANK.get(self.parent.level, 3) >= self.rank:
                raise ValidationError(
                    {"parent": f"A {self.get_level_display()} cannot sit under a {self.parent.get_level_display()}."}
                )
        if self.boundary in (None, "", []):
            self.boundary = None
            return
        polygons = _as_polygons(self.boundary)
        if polygons is None:
            raise ValidationError(
                {"boundary": "Enter GeoJSON Polygon or MultiPolygon coordinates ([lng, lat] pairs, at least 4 points per ring)."}
            )
        outers = [point for polygon in polygons for point in polygon[0]]
        self.min_longitude = Decimal(str(round(min(float(p[0]) for p in outers), 6)))
        self.max_longitude = Decimal(str(round(max(float(p[0]) for p in outers), 6)))
        self.min_latitude = Decimal(str(round(min(float(p[1]) for p in outers), 6)))
        self.max_latitude = Decimal(str(round(max(float(p[1]) for p in outers), 6)))

    def save(self, *args, **kwargs):
        if self.boundary:
            self.clean()  # validate the polygon and derive the bounding box from it
        old_path = self.path
        super().save(*args, **kwargs)
        new_path = f"{self.parent.path if self.parent_id else '/'}{self.pk}/"
        if new_path != old_path:
            ServiceArea.objects.filter(pk=self.pk).update(path=new_path)
            if old_path:
                # Moving an area moves its whole subtree.
                for child in ServiceArea.objects.filter(path__startswith=old_path).exclude(pk=self.pk):
                    ServiceArea.objects.filter(pk=child.pk).update(path=new_path + child.path[len(old_path):])
            self.path = new_path

    def contains(self, latitude, longitude):
        latitude, longitude = Decimal(str(latitude)), Decimal(str(longitude))
        if not (self.min_latitude <= latitude <= self.max_latitude and self.min_longitude <= longitude <= self.max_longitude):
            return False
        if not self.boundary:
            return True
        lat, lng = float(latitude), float(longitude)
        for polygon in _as_polygons(self.boundary) or []:
            outer, holes = polygon[0], polygon[1:]
            if _point_in_ring(lat, lng, outer) and not any(_point_in_ring(lat, lng, hole) for hole in holes):
                return True
        return False

    @classmethod
    def locate(cls, latitude, longitude):
        """The most specific active area containing the point (deepest in the tree, then smallest), or None."""
        candidates = cls.objects.filter(
            is_active=True,
            min_latitude__lte=latitude,
            max_latitude__gte=latitude,
            min_longitude__lte=longitude,
            max_longitude__gte=longitude,
        )
        matches = [area for area in candidates if area.contains(latitude, longitude)]
        return min(
            matches,
            key=lambda a: (-a.depth, -a.rank, (a.max_latitude - a.min_latitude) * (a.max_longitude - a.min_longitude)),
            default=None,
        )


class Department(models.Model):
    name = models.CharField(max_length=120, unique=True)
    code = models.SlugField(max_length=40, unique=True)
    description = models.TextField(blank=True)
    contact_email = models.EmailField(blank=True)
    service_areas = models.ManyToManyField(ServiceArea, blank=True, related_name="departments")
    allow_gallery_resolution = models.BooleanField(
        default=False,
        help_text="Documented exception: allow officers to pick resolution photos from the gallery.",
    )
    allow_resolution_without_evidence = models.BooleanField(
        default=False,
        help_text="Documented exception: allow resolving without a resolution photograph.",
    )
    is_active = models.BooleanField(default=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name
