"""Issues go only to the authorities responsible for the place where the issue is located."""
from decimal import Decimal

from apps.accounts.models import Role
from apps.core.tests.helpers import CivicEyeTestCase
from apps.departments.models import ServiceArea
from apps.notifications.models import Notification

# A point inside the "North" test area (Central is 9.93–10.02 lat).
NORTH_LAT, NORTH_LNG = Decimal("10.150000"), Decimal("76.280000")


class JurisdictionTests(CivicEyeTestCase):
    def setUp(self):
        super().setUp()
        self.north_officer = self.make_user("north.officer", Role.OFFICER, self.sanitation, areas=[self.north])
        self.north_supervisor = self.make_user("north.supervisor", Role.SUPERVISOR, self.sanitation, areas=[self.north])

    def test_issue_is_routed_to_the_area_where_it_is_located(self):
        central = self.create_issue(seed=1)
        north = self.create_issue(seed=2, lat=NORTH_LAT, lng=NORTH_LNG)
        self.assertEqual(central.service_area, self.central)
        self.assertEqual(north.service_area, self.north)

        self.login(self.officer)
        self.assertEqual([i["id"] for i in self.client.get("/api/authority/issues/").data["results"]], [central.pk])
        self.assertError(self.client.get(f"/api/authority/issues/{north.pk}/"), 404)

        self.login(self.north_officer)
        self.assertEqual([i["id"] for i in self.client.get("/api/authority/issues/").data["results"]], [north.pk])

        # Supervisors are limited to their areas too.
        self.login(self.supervisor)
        self.assertEqual(self.client.get("/api/authority/issues/").data["count"], 1)
        self.login(self.admin)
        self.assertEqual(self.client.get("/api/authority/issues/").data["count"], 2)

    def test_only_local_staff_are_notified(self):
        north = self.create_issue(seed=2, lat=NORTH_LAT, lng=NORTH_LNG)
        self.assertTrue(Notification.objects.filter(recipient=self.north_officer, issue=north, notification_type="NEW_ISSUE").exists())
        self.assertFalse(Notification.objects.filter(recipient=self.officer, issue=north).exists())
        self.assertFalse(Notification.objects.filter(recipient=self.supervisor, issue=north).exists())

    def test_dashboard_counts_only_local_issues(self):
        self.create_issue(seed=1)
        self.create_issue(seed=2, lat=NORTH_LAT, lng=NORTH_LNG)
        self.create_issue(seed=3, lat=NORTH_LAT, lng=NORTH_LNG)
        self.login(self.north_officer)
        self.assertEqual(self.client.get("/api/authority/dashboard/").data["kpis"]["total"], 2)

    def test_issue_outside_every_area_goes_to_administrators(self):
        far = self.create_issue(seed=4, lat=Decimal("12.900000"), lng=Decimal("77.600000"))
        self.assertIsNone(far.service_area)
        self.assertTrue(Notification.objects.filter(recipient=self.admin, issue=far).exists())
        self.assertFalse(Notification.objects.filter(recipient__role__in=["OFFICER", "SUPERVISOR"], issue=far).exists())
        self.login(self.officer)
        self.assertError(self.client.get(f"/api/authority/issues/{far.pk}/"), 404)
        self.login(self.admin)
        self.assertEqual(self.client.get(f"/api/authority/issues/{far.pk}/").status_code, 200)

    def test_staff_without_an_area_see_only_issues_assigned_to_them(self):
        unscoped = self.make_user("unscoped", Role.OFFICER, self.sanitation)
        issue = self.create_issue(seed=1)
        self.login(unscoped)
        self.assertEqual(self.client.get("/api/authority/issues/").data["count"], 0)

    def test_assignment_only_to_officers_covering_the_location(self):
        issue = self.create_issue(seed=1)
        self.login(self.supervisor)
        response = self.client.post(
            f"/api/authority/issues/{issue.pk}/assign/", {"department_id": self.sanitation.pk, "officer_id": self.north_officer.pk}
        )
        self.assertError(response, 400, "validation_error")
        officers = self.client.get(f"/api/authority/officers/?department={self.sanitation.pk}&issue={issue.pk}").data
        self.assertEqual({o["username"] for o in officers}, {"officer", "supervisor"})


class ServiceAreaBoundaryTests(CivicEyeTestCase):
    def test_polygon_boundary_is_exact_and_sets_the_bounding_box(self):
        # A triangle: the bounding box covers (10.5, 76.5) but the polygon does not.
        area = ServiceArea.objects.create(
            name="Triangle",
            code="triangle",
            min_latitude=0, max_latitude=0, min_longitude=0, max_longitude=0,
            boundary=[[[76.0, 10.0], [77.0, 10.0], [76.0, 11.0], [76.0, 10.0]]],
        )
        self.assertEqual((area.min_latitude, area.max_latitude), (Decimal("10.0"), Decimal("11.0")))
        self.assertTrue(area.contains(10.2, 76.2))
        self.assertFalse(area.contains(10.9, 76.9))
        self.assertEqual(ServiceArea.locate(Decimal("10.2"), Decimal("76.2")), area)
        self.assertIsNone(ServiceArea.locate(Decimal("10.9"), Decimal("76.9")))
