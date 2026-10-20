"""Hierarchical jurisdictions: State → District → Taluk → Panchayat / Corporation, with admins at each level."""
import json
import tempfile
from decimal import Decimal as D
from pathlib import Path

from django.core.exceptions import ValidationError
from django.core.management import call_command

from apps.accounts.models import Role
from apps.core.tests.helpers import PASSWORD, CivicEyeTestCase
from apps.departments.models import AreaLevel, ServiceArea
from apps.notifications.models import Notification


def area(name, code, level, parent, box):
    return ServiceArea.objects.create(
        name=name, code=code, level=level, parent=parent,
        min_latitude=D(box[0]), max_latitude=D(box[1]), min_longitude=D(box[2]), max_longitude=D(box[3]),
    )


# Points used below
IN_KUMBALANGHI = (D("9.880000"), D("76.290000"))
IN_KOCHI = (D("9.980000"), D("76.280000"))
IN_ERNAKULAM_ONLY = (D("10.200000"), D("76.600000"))
IN_THRISSUR = (D("10.520000"), D("76.210000"))


class HierarchyTestCase(CivicEyeTestCase):
    def setUp(self):
        super().setUp()
        self.kerala = area("Kerala", "kerala", AreaLevel.STATE, None, ("8.0", "13.0", "74.0", "78.0"))
        self.ernakulam = area("Ernakulam", "ernakulam", AreaLevel.DISTRICT, self.kerala, ("9.70", "10.30", "76.15", "76.80"))
        self.thrissur = area("Thrissur", "thrissur", AreaLevel.DISTRICT, self.kerala, ("10.31", "10.80", "75.90", "76.60"))
        self.kanayannur = area("Kanayannur", "kanayannur", AreaLevel.TALUK, self.ernakulam, ("9.80", "9.95", "76.25", "76.40"))
        self.kumbalanghi = area("Kumbalanghi", "kumbalanghi", AreaLevel.GRAMA_PANCHAYAT, self.kanayannur, ("9.85", "9.90", "76.27", "76.31"))
        self.kochi = area("Kochi", "kochi-corp", AreaLevel.CORPORATION, self.ernakulam, ("9.96", "10.05", "76.24", "76.33"))

        # Admins at each level (self.admin from the base class has no area: the state/global admin).
        self.district_admin = self.make_user("ekm.admin", Role.ADMIN, areas=[self.ernakulam])
        self.panchayat_admin = self.make_user("kumbalanghi.admin", Role.ADMIN, areas=[self.kumbalanghi])
        self.thrissur_admin = self.make_user("tsr.admin", Role.ADMIN, areas=[self.thrissur])
        # Sanitation officers at panchayat and district level.
        self.gp_officer = self.make_user("kumbalanghi.sanitation", Role.OFFICER, self.sanitation, areas=[self.kumbalanghi])
        self.district_officer = self.make_user("ekm.sanitation", Role.OFFICER, self.sanitation, areas=[self.ernakulam])

    def issue_at(self, point, seed, category=None):
        return self.create_issue(lat=point[0], lng=point[1], seed=seed, category=category)

    def visible_ids(self, user):
        self.login(user)
        return {i["id"] for i in self.client.get("/api/authority/issues/?page_size=100").data["results"]}


class TreeTests(HierarchyTestCase):
    def test_paths_and_deepest_location(self):
        self.assertEqual(self.kumbalanghi.path, f"/{self.kerala.pk}/{self.ernakulam.pk}/{self.kanayannur.pk}/{self.kumbalanghi.pk}/")
        self.assertEqual(ServiceArea.locate(*IN_KUMBALANGHI), self.kumbalanghi)
        self.assertEqual(ServiceArea.locate(*IN_KOCHI), self.kochi)
        self.assertEqual(ServiceArea.locate(*IN_ERNAKULAM_ONLY), self.ernakulam)

    def test_level_rules(self):
        bad = ServiceArea(name="Bad", code="bad", level=AreaLevel.DISTRICT, parent=self.kumbalanghi,
                          min_latitude=0, max_latitude=1, min_longitude=0, max_longitude=1)
        with self.assertRaises(ValidationError):
            bad.full_clean()

    def test_moving_an_area_moves_its_subtree(self):
        self.kanayannur.parent = self.thrissur
        self.kanayannur.save()
        self.kumbalanghi.refresh_from_db()
        self.assertTrue(self.kumbalanghi.path.startswith(self.thrissur.path))


class VisibilityAndRoutingTests(HierarchyTestCase):
    def test_each_admin_sees_their_subtree_only(self):
        gp = self.issue_at(IN_KUMBALANGHI, 1)
        kochi = self.issue_at(IN_KOCHI, 2, category=self.pothole)
        tsr = self.issue_at(IN_THRISSUR, 3)
        self.assertEqual(self.visible_ids(self.district_admin), {gp.pk, kochi.pk})  # all departments, whole district
        self.assertEqual(self.visible_ids(self.panchayat_admin), {gp.pk})
        self.assertEqual(self.visible_ids(self.thrissur_admin), {tsr.pk})
        self.assertEqual(self.visible_ids(self.admin), {gp.pk, kochi.pk, tsr.pk})  # state admin
        self.assertEqual(self.visible_ids(self.district_officer), {gp.pk})  # sanitation only, whole district
        self.assertEqual(self.visible_ids(self.gp_officer), {gp.pk})

    def test_area_filter_includes_sub_areas(self):
        gp = self.issue_at(IN_KUMBALANGHI, 1)
        kochi = self.issue_at(IN_KOCHI, 2)
        self.login(self.district_admin)
        ids = {i["id"] for i in self.client.get(f"/api/authority/issues/?service_area={self.kanayannur.pk}").data["results"]}
        self.assertEqual(ids, {gp.pk})
        ids = {i["id"] for i in self.client.get(f"/api/authority/issues/?service_area={self.ernakulam.pk}").data["results"]}
        self.assertEqual(ids, {gp.pk, kochi.pk})

    def test_routed_to_nearest_level_with_staff(self):
        gp = self.issue_at(IN_KUMBALANGHI, 1)
        self.assertTrue(Notification.objects.filter(issue=gp, recipient=self.gp_officer).exists())
        self.assertFalse(Notification.objects.filter(issue=gp, recipient=self.district_officer).exists())

        kochi = self.issue_at(IN_KOCHI, 2)  # no Kochi sanitation officer yet → district level
        self.assertTrue(Notification.objects.filter(issue=kochi, recipient=self.district_officer).exists())

        pothole = self.issue_at(IN_KUMBALANGHI, 3, category=self.pothole)  # no PWD staff anywhere → nearest admin
        self.assertTrue(Notification.objects.filter(issue=pothole, recipient=self.panchayat_admin).exists())
        self.assertFalse(Notification.objects.filter(issue=pothole, recipient=self.district_admin).exists())

    def test_district_officer_can_be_assigned_panchayat_issues(self):
        gp = self.issue_at(IN_KUMBALANGHI, 1)
        self.login(self.district_admin)
        officers = {o["username"] for o in self.client.get(f"/api/authority/officers/?department={self.sanitation.pk}&issue={gp.pk}").data}
        self.assertEqual(officers, {"kumbalanghi.sanitation", "ekm.sanitation"})
        response = self.client.post(f"/api/authority/issues/{gp.pk}/assign/", {"department_id": self.sanitation.pk, "officer_id": self.district_officer.pk})
        self.assertEqual(response.status_code, 200, response.data)

    def test_areas_endpoint_is_scoped(self):
        self.login(self.district_admin)
        codes = [a["code"] for a in self.client.get("/api/authority/areas/").data]
        self.assertEqual(codes[0], "ernakulam")  # tree order: parent first
        self.assertEqual(set(codes), {"ernakulam", "kanayannur", "kumbalanghi", "kochi-corp"})


class TeamManagementTests(HierarchyTestCase):
    url = "/api/authority/team/"

    def new_member(self, **overrides):
        body = {
            "username": "kochi.admin",
            "full_name": "Kochi Admin",
            "role": "ADMIN",
            "service_area_ids": [self.kochi.pk],
            "password": "Kochi-Secure-2026",
        }
        body.update(overrides)
        return self.client.post(self.url, body, format="json")

    def test_district_admin_lists_only_their_staff(self):
        self.login(self.district_admin)
        names = {m["username"] for m in self.client.get(self.url).data["results"]}
        self.assertEqual(names, {"kumbalanghi.admin", "kumbalanghi.sanitation", "ekm.sanitation"})

    def test_district_admin_creates_sub_admin_who_can_sign_in(self):
        self.login(self.district_admin)
        response = self.new_member()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual([a["code"] for a in response.data["service_areas"]], ["kochi-corp"])
        self.client.force_authenticate(user=None)
        login = self.client.post("/api/auth/login/", {"username": "kochi.admin", "password": "Kochi-Secure-2026"}, format="json")
        self.assertEqual(login.status_code, 200)
        self.assertFalse(login.data["user"]["is_global_admin"])

    def test_cannot_grant_areas_outside_own_jurisdiction_or_global_access(self):
        self.login(self.district_admin)
        self.assertError(self.new_member(service_area_ids=[self.thrissur.pk]), 400, "validation_error")
        self.assertError(self.new_member(service_area_ids=[]), 400, "validation_error")  # would be a global admin
        self.assertError(self.new_member(service_area_ids=[self.kerala.pk]), 400, "validation_error")  # above them

    def test_officers_need_a_department(self):
        self.login(self.district_admin)
        response = self.new_member(username="kochi.officer", role="OFFICER")
        self.assertError(response, 400, "validation_error")
        self.assertIn("department_id", response.data["error"]["details"])
        ok = self.new_member(username="kochi.officer", role="OFFICER", department_id=self.sanitation.pk)
        self.assertEqual(ok.status_code, 201, ok.data)

    def test_cannot_touch_staff_outside_jurisdiction_or_self(self):
        self.login(self.district_admin)
        self.assertError(self.client.patch(f"{self.url}{self.thrissur_admin.pk}/", {"full_name": "X"}, format="json"), 404)
        self.assertError(self.client.patch(f"{self.url}{self.admin.pk}/", {"full_name": "X"}, format="json"), 404)
        self.assertError(self.client.patch(f"{self.url}{self.district_admin.pk}/", {"service_area_ids": [self.kerala.pk]}, format="json"), 403)
        self.login(self.panchayat_admin)
        self.assertError(self.client.patch(f"{self.url}{self.district_admin.pk}/", {"full_name": "X"}, format="json"), 404)

    def test_edit_deactivate_and_reset_password(self):
        self.login(self.district_admin)
        member_url = f"{self.url}{self.gp_officer.pk}/"
        updated = self.client.patch(member_url, {"full_name": "Renamed Officer", "service_area_ids": [self.kochi.pk]}, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual([a["code"] for a in updated.data["service_areas"]], ["kochi-corp"])

        reset = self.client.post(f"{member_url}reset-password/", {"new_password": "Fresh-Pass-2026"}, format="json")
        self.assertEqual(reset.status_code, 200, reset.data)
        self.client.force_authenticate(user=None)
        self.assertEqual(
            self.client.post("/api/auth/login/", {"username": "kumbalanghi.sanitation", "password": "Fresh-Pass-2026"}, format="json").status_code,
            200,
        )
        self.login(self.district_admin)
        self.assertFalse(self.client.patch(member_url, {"is_active": False}, format="json").data["is_active"])
        self.client.force_authenticate(user=None)
        self.assertError(
            self.client.post("/api/auth/login/", {"username": "kumbalanghi.sanitation", "password": "Fresh-Pass-2026"}, format="json"), 401
        )
        from apps.audit.models import AuditLog

        self.assertTrue(AuditLog.objects.filter(action="team.password_reset", entity_id=str(self.gp_officer.pk)).exists())

    def test_officers_and_supervisors_cannot_manage_team(self):
        self.login(self.gp_officer)
        self.assertError(self.client.get(self.url), 403)


class ImportAreasTests(HierarchyTestCase):
    def test_import_with_auto_parent(self):
        def square(lat, lng, size=0.01):
            return [[[lng, lat], [lng + size, lat], [lng + size, lat + size], [lng, lat + size], [lng, lat]]]

        data = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "properties": {"LSGI": "Chellanam"}, "geometry": {"type": "Polygon", "coordinates": square(9.82, 76.27)}},
                {"type": "Feature", "properties": {"LSGI": "Vatanappally"}, "geometry": {"type": "MultiPolygon", "coordinates": [square(10.45, 76.05)]}},
                {"type": "Feature", "properties": {"LSGI": ""}, "geometry": {"type": "Polygon", "coordinates": square(9.9, 76.3)}},
            ],
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "lsg.geojson"
            path.write_text(json.dumps(data), encoding="utf-8")
            call_command("import_areas", str(path), "--level", "GRAMA_PANCHAYAT", "--name-field", "LSGI", "--auto-parent", stdout=open(Path(tmp) / "out.txt", "w"), stderr=open(Path(tmp) / "err.txt", "w"))

        chellanam = ServiceArea.objects.get(name="Chellanam")
        self.assertEqual(chellanam.parent, self.kanayannur)  # deepest higher-level area containing it
        self.assertEqual(chellanam.level, AreaLevel.GRAMA_PANCHAYAT)
        self.assertTrue(chellanam.contains(D("9.825"), D("76.275")))
        self.assertEqual(ServiceArea.objects.get(name="Vatanappally").parent, self.thrissur)
        self.assertEqual(ServiceArea.locate(D("9.825"), D("76.275")), chellanam)
