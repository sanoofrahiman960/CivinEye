"""Import jurisdictions (districts, taluks, panchayats, municipalities, wards) from a GeoJSON file.

    python manage.py import_areas districts.geojson --level DISTRICT --name-field DISTRICT --parent kerala
    python manage.py import_areas taluks.geojson --level TALUK --name-field TALUK --auto-parent
    python manage.py import_areas lsg.geojson --level GRAMA_PANCHAYAT --name-field LSGI --auto-parent --dry-run

Each Polygon/MultiPolygon feature becomes a ServiceArea with its exact boundary. The parent is either
fixed (--parent CODE) or found automatically (--auto-parent: the deepest existing higher-level area that
contains the feature's centre). Re-running updates existing areas (matched by code) instead of duplicating.
Import top-down: state, then districts, then taluks, then local bodies, then wards.
"""
import json
from decimal import Decimal

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils.text import slugify

from apps.departments.models import LEVEL_RANK, AreaLevel, ServiceArea, _as_polygons


def _centre(polygons):
    """Centre of the largest outer ring's bounding box: good enough to find the containing parent."""
    ring = max((polygon[0] for polygon in polygons), key=len)
    lngs = [float(p[0]) for p in ring]
    lats = [float(p[1]) for p in ring]
    return (min(lats) + max(lats)) / 2, (min(lngs) + max(lngs)) / 2


class Command(BaseCommand):
    help = "Import service areas (jurisdictions) with exact boundaries from a GeoJSON FeatureCollection."

    def add_arguments(self, parser):
        parser.add_argument("geojson", help="Path to a GeoJSON FeatureCollection file.")
        parser.add_argument("--level", required=True, choices=[c.value for c in AreaLevel], help="Level of every feature.")
        parser.add_argument("--name-field", default="name", help="Feature property holding the area name.")
        parser.add_argument("--code-field", help="Feature property holding a unique code (default: slug of parent + name).")
        group = parser.add_mutually_exclusive_group()
        group.add_argument("--parent", help="Code of the parent area for every feature.")
        group.add_argument("--auto-parent", action="store_true", help="Find each parent by location.")
        parser.add_argument("--dry-run", action="store_true", help="Show what would happen without saving.")

    def handle(self, *args, **options):
        try:
            with open(options["geojson"], encoding="utf-8") as handle:
                data = json.load(handle)
        except (OSError, ValueError) as exc:
            raise CommandError(f"Could not read GeoJSON: {exc}")
        features = data.get("features") if isinstance(data, dict) else None
        if not features:
            raise CommandError("Expected a GeoJSON FeatureCollection with features.")

        level = options["level"]
        fixed_parent = None
        if options["parent"]:
            fixed_parent = ServiceArea.objects.filter(code=options["parent"]).first()
            if fixed_parent is None:
                raise CommandError(f"No area with code '{options['parent']}'. Import the higher level first.")

        possible_parents = list(
            ServiceArea.objects.filter(is_active=True).exclude(level=level)
        ) if options["auto_parent"] else []
        possible_parents = [a for a in possible_parents if LEVEL_RANK.get(a.level, 3) < LEVEL_RANK[level]]

        created = updated = skipped = 0
        with transaction.atomic():
            for index, feature in enumerate(features, start=1):
                props = feature.get("properties") or {}
                geometry = feature.get("geometry") or {}
                name = str(props.get(options["name_field"]) or "").strip()
                polygons = _as_polygons(geometry.get("coordinates")) if geometry.get("type") in ("Polygon", "MultiPolygon") else None
                if not name or polygons is None:
                    self.stderr.write(f"  feature {index}: skipped (missing name or Polygon/MultiPolygon geometry)")
                    skipped += 1
                    continue

                parent = fixed_parent
                if options["auto_parent"]:
                    lat, lng = _centre(polygons)
                    containing = [a for a in possible_parents if a.contains(Decimal(str(lat)), Decimal(str(lng)))]
                    parent = max(containing, key=lambda a: (a.depth, a.rank), default=None)

                if options["code_field"] and props.get(options["code_field"]):
                    code = slugify(str(props[options["code_field"]]))[:60]
                else:
                    code = slugify(f"{parent.code}-{name}" if parent else name)[:60]

                # Update an existing area with the same code, or the same name under the same parent
                # (e.g. a hand-made "Ernakulam" placeholder), instead of creating a duplicate.
                area = (
                    ServiceArea.objects.filter(code=code).first()
                    or ServiceArea.objects.filter(parent=parent, name__iexact=name).first()
                    or ServiceArea.objects.filter(level=level, name__iexact=name, parent__isnull=True).first()
                )
                is_new = area is None
                area = area or ServiceArea(code=code)
                area.name, area.level, area.parent = name, level, parent
                area.boundary = geometry["coordinates"]
                # Placeholders; clean() replaces them with the boundary's real extent.
                for field in ("min_latitude", "max_latitude", "min_longitude", "max_longitude"):
                    if getattr(area, field) is None:
                        setattr(area, field, Decimal("0"))
                try:
                    with transaction.atomic():  # one bad feature must not abort the whole import
                        area.full_clean(exclude=["path"])
                        area.save()
                except ValidationError as exc:
                    self.stderr.write(f"  feature {index} ({name}): skipped: {'; '.join(exc.messages)}")
                    skipped += 1
                    continue
                created += is_new
                updated += not is_new
                where = f" in {parent.name}" if parent else " (top level)"
                self.stdout.write(f"  {'created' if is_new else 'updated'} {area.get_level_display()}: {name}{where}")

            if options["dry_run"]:
                transaction.set_rollback(True)

        summary = f"{created} created, {updated} updated, {skipped} skipped"
        if options["dry_run"]:
            self.stdout.write(self.style.WARNING(f"Dry run — nothing saved ({summary})."))
        else:
            self.stdout.write(self.style.SUCCESS(f"Done: {summary}."))
