"""Jurisdiction rules shared by issue visibility, routing, assignment and team management.

Staff are assigned one or more service areas. An assignment to an area covers that area and every
area below it (a district covers its taluks, panchayats, municipalities and wards).

- Global (state/system) admin: role ADMIN with no service area (or a Django superuser) — sees everything.
- Area admin: role ADMIN with service areas — everything inside them, across all departments, and
  manages the staff working there.
- Supervisor / officer: their department's issues inside their areas.
"""
from django.contrib.auth import get_user_model
from django.db.models import Q

from .models import ServiceArea

ADMIN, SUPERVISOR, OFFICER = "ADMIN", "SUPERVISOR", "OFFICER"


def subtree_ids(areas):
    """Ids of the given areas and everything below them."""
    paths = [a.path for a in areas if a.path]
    if not paths:
        return set()
    query = Q()
    for path in paths:
        query |= Q(path__startswith=path)
    return set(ServiceArea.objects.filter(query).values_list("id", flat=True))


def is_global_admin(user):
    if not user.is_authenticated or user.role != ADMIN:
        return False
    return user.is_superuser or not user.service_areas.exists()


def jurisdiction_ids(user):
    """Area ids the user is responsible for, or None meaning "everywhere" (global admin)."""
    if is_global_admin(user):
        return None
    return subtree_ids(user.service_areas.all())


def covers_area(user, area_id):
    ids = jurisdiction_ids(user)
    return ids is None or area_id in ids


def areas_within(user, areas):
    """True when every area lies inside the user's jurisdiction."""
    ids = jurisdiction_ids(user)
    return ids is None or all(a.pk in ids for a in areas)


def nearest_staff(area, roles, department_id=None):
    """Active staff assigned at the most local level that has any, walking up from `area`.

    An issue in a panchayat goes to that panchayat's staff; if it has none yet, to the taluk's, then the
    district's, and so on — so issues are never lost while a region is being onboarded.
    """
    User = get_user_model()
    if area is None:
        return User.objects.none()
    staff = User.objects.filter(role__in=roles, is_active=True)
    if department_id is not None:
        staff = staff.filter(department_id=department_id)
    for area_id in reversed(area.ancestor_ids()):
        level_staff = staff.filter(service_areas=area_id).distinct()
        if level_staff.exists():
            return level_staff
    return User.objects.none()


def global_admins():
    User = get_user_model()
    admins = User.objects.filter(role=ADMIN, is_active=True)
    return admins.filter(Q(is_superuser=True) | Q(service_areas__isnull=True)).distinct()
