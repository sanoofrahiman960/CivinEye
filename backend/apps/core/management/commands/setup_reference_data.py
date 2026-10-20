"""Create the reference configuration CivicEye needs to work: feature flags, platform policies,
service areas, departments, issue categories (with SLAs) and emergency numbers.

    python manage.py setup_reference_data

Creates no users and no issues. Safe to run repeatedly: existing rows are left unchanged, so edits
made in Django admin are kept. Review everything in Django admin for your own city.
"""
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from apps.core.models import DEFAULT_FEATURE_FLAGS, FeatureFlag, PlatformConfiguration
from apps.departments.models import AreaLevel, Department, ServiceArea
from apps.issues.models import EmergencyContact, IssueCategory, IssueSubcategory

# Jurisdictions. Issues located inside an area are routed only to officers assigned to that area.
# Approximate extent of Kochi Municipal Corporation; paste the official boundary polygon in Django admin
# (Service areas -> Boundary) for exact routing, and add an area for each city/municipality you serve.
SERVICE_AREAS = [
    # (name, code, level, parent code, (min_lat, max_lat, min_lng, max_lng)) — parents before children.
    ("Kerala", "kerala", AreaLevel.STATE, None, (8.1700, 12.7900, 74.8500, 77.4200)),
    ("Ernakulam", "ernakulam-district", AreaLevel.DISTRICT, "kerala", (9.7000, 10.3000, 76.1500, 76.8000)),
    ("Kochi", "kochi", AreaLevel.CORPORATION, "ernakulam-district", (9.8900, 10.0600, 76.2200, 76.3400)),
]

DEPARTMENTS = [
    ("Municipal Corporation", "municipal", "Roads, public property and general civic services."),
    ("Public Works Department", "pwd", "Roads, bridges and public buildings."),
    ("Water Authority", "water", "Water supply and pipeline leaks."),
    ("Sanitation Department", "sanitation", "Waste collection, bins and public sanitation."),
    ("Electrical Department", "electrical", "Streetlights and electrical hazards."),
]

# name, slug, department code, default priority, ack hours, resolve hours, life threatening, icon, subcategories
CATEGORIES = [
    ("Garbage on road", "garbage-on-road", "sanitation", "MEDIUM", 24, 72, False, "trash-outline", ["Household waste", "Construction debris", "Dead animal"]),
    ("Overflowing bin", "overflowing-bin", "sanitation", "MEDIUM", 24, 48, False, "trash-bin-outline", []),
    ("Waterlogging", "waterlogging", "municipal", "HIGH", 12, 72, False, "water-outline", ["Road flooding", "Residential flooding"]),
    ("Pothole / damaged road", "pothole", "pwd", "MEDIUM", 48, 240, False, "car-outline", ["Pothole", "Broken road edge", "Damaged footpath"]),
    ("Broken streetlight", "streetlight", "electrical", "LOW", 48, 168, False, "bulb-outline", []),
    ("Water leakage", "water-leakage", "water", "MEDIUM", 24, 96, False, "water", ["Pipeline burst", "Leaking tap", "Contaminated supply"]),
    ("Damaged public property", "damaged-property", "municipal", "LOW", 72, 336, False, "construct-outline", []),
    ("Blocked drain", "blocked-drain", "municipal", "MEDIUM", 24, 120, False, "funnel-outline", []),
    ("Illegal dumping", "illegal-dumping", "sanitation", "HIGH", 24, 96, False, "warning-outline", []),
    ("Public sanitation", "public-sanitation", "sanitation", "MEDIUM", 48, 168, False, "medkit-outline", ["Public toilet", "Open defecation"]),
    ("Fallen live electric wire", "live-wire", "electrical", "CRITICAL", 1, 6, True, "flash-outline", []),
    ("Open manhole", "open-manhole", "municipal", "CRITICAL", 1, 24, True, "alert-circle-outline", []),
    ("Other civic issue", "other", "municipal", "UNCLASSIFIED", 72, 336, False, "ellipsis-horizontal-circle-outline", []),
]

# Demo data for Kerala, India. Administrators must verify numbers for their own area.
EMERGENCY_CONTACTS = [
    ("National emergency", "112", None, 0),
    ("Fire and rescue", "101", None, 1),
    ("Police", "100", None, 2),
    ("Ambulance", "108", None, 3),
    ("KSEB electrical emergency", "1912", "live-wire", 4),
]


def create_reference_data():
    """Create missing reference rows. Returns (departments by code, categories by slug)."""
    PlatformConfiguration.load()
    for key, defaults in DEFAULT_FEATURE_FLAGS.items():
        FeatureFlag.objects.get_or_create(
            key=key,
            defaults={"is_enabled": defaults["enabled"], "config": defaults["config"], "description": defaults["description"]},
        )

    areas = {}
    for name, code, level, parent_code, (min_lat, max_lat, min_lng, max_lng) in SERVICE_AREAS:
        parent = areas.get(parent_code)
        area, created = ServiceArea.objects.get_or_create(
            code=code,
            defaults={
                "name": name,
                "level": level,
                "parent": parent,
                "min_latitude": Decimal(str(min_lat)),
                "max_latitude": Decimal(str(max_lat)),
                "min_longitude": Decimal(str(min_lng)),
                "max_longitude": Decimal(str(max_lng)),
            },
        )
        if not created and area.level == AreaLevel.OTHER and area.parent_id is None:
            # Upgrade an area created before the hierarchy existed (keeps any admin edits otherwise).
            area.level, area.parent = level, parent
            area.save()
        areas[code] = area

    departments = {}
    for name, code, description in DEPARTMENTS:
        dept, created = Department.objects.get_or_create(code=code, defaults={"name": name, "description": description})
        if created:
            dept.service_areas.add(*areas.values())
        departments[code] = dept

    categories = {}
    for order, (name, slug, dept, priority, ack, resolve, life, icon, subs) in enumerate(CATEGORIES):
        category, _ = IssueCategory.objects.get_or_create(
            slug=slug,
            defaults={
                "name": name,
                "default_department": departments[dept],
                "default_priority": priority,
                "sla_ack_hours": ack,
                "sla_resolve_hours": resolve,
                "is_life_threatening": life,
                "icon": icon,
                "display_order": order,
            },
        )
        for sub in subs:
            IssueSubcategory.objects.get_or_create(category=category, name=sub)
        categories[slug] = category

    for name, phone, category_slug, order in EMERGENCY_CONTACTS:
        EmergencyContact.objects.get_or_create(
            name=name, phone_number=phone, defaults={"category": categories.get(category_slug), "display_order": order}
        )
    return departments, categories


class Command(BaseCommand):
    help = "Create CivicEye reference data (departments, categories, SLAs, emergency numbers, feature flags). No users or issues."

    @transaction.atomic
    def handle(self, *args, **options):
        departments, categories = create_reference_data()
        self.stdout.write(
            self.style.SUCCESS(
                f"Reference data ready: {len(departments)} departments, {len(categories)} categories, "
                f"{ServiceArea.objects.count()} service areas, {EmergencyContact.objects.count()} emergency numbers."
            )
        )
        self.stdout.write("Next: create an administrator with `python manage.py createsuperuser`, then add")
        self.stdout.write("department officers in Django admin (/admin/). Citizens register in the mobile app.")
