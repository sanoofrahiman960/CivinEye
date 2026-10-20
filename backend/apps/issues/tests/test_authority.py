import csv
import io
from datetime import timedelta
from decimal import Decimal

from django.utils import timezone

from apps.assignments.models import IssueAssignment
from apps.core.tests.helpers import ISSUE_LAT, ISSUE_LNG, CivicEyeTestCase, make_image
from apps.issues.models import Issue, IssueComment, IssueImage, IssuePriorityChange
from apps.notifications.models import Notification


class AuthorityScopeTests(CivicEyeTestCase):
    def test_officer_sees_only_own_department(self):
        garbage = self.create_issue(category=self.garbage, seed=1)
        pothole = self.create_issue(category=self.pothole, seed=2)
        self.login(self.officer)
        ids = [i["id"] for i in self.client.get("/api/authority/issues/").data["results"]]
        self.assertEqual(ids, [garbage.pk])
        self.assertError(self.client.get(f"/api/authority/issues/{pothole.pk}/"), 404)
        self.assertError(self.client.post(f"/api/authority/issues/{pothole.pk}/acknowledge/"), 404)

    def test_officer_service_area_restriction(self):
        central = self.create_issue(seed=1)
        north = self.create_issue(seed=2, lat=Decimal("10.150000"), lng=Decimal("76.280000"))
        self.officer.service_areas.set([self.north])
        self.login(self.officer)
        ids = {i["id"] for i in self.client.get("/api/authority/issues/").data["results"]}
        self.assertEqual(ids, {north.pk})
        self.assertError(self.client.get(f"/api/authority/issues/{central.pk}/"), 404)

    def test_supervisor_sees_department_and_admin_sees_all(self):
        self.create_issue(category=self.garbage, seed=1)
        self.create_issue(category=self.pothole, seed=2)
        self.login(self.supervisor)
        self.assertEqual(self.client.get("/api/authority/issues/").data["count"], 1)
        self.login(self.admin)
        self.assertEqual(self.client.get("/api/authority/issues/").data["count"], 2)

    def test_detail_includes_reporter_contact_for_authority(self):
        issue = self.create_issue()
        self.login(self.officer)
        data = self.client.get(f"/api/authority/issues/{issue.pk}/").data
        self.assertEqual(data["reporter"]["phone_number"], self.citizen.phone_number)
        self.assertIn("acknowledge", data["available_actions"])
        self.assertNotIn("resolve", data["available_actions"])

    def test_filters_and_sorting(self):
        old = self.create_issue(seed=1, title="Old garbage pile")
        Issue.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=10), due_at=timezone.now() - timedelta(days=1))
        new = self.create_issue(seed=2, title="Fresh garbage pile")
        self.login(self.officer)
        oldest = self.client.get("/api/authority/issues/?sort=oldest").data["results"]
        self.assertEqual(oldest[0]["id"], old.pk)
        overdue = self.client.get("/api/authority/issues/?overdue=true").data["results"]
        self.assertEqual([i["id"] for i in overdue], [old.pk])
        self.assertTrue(overdue[0]["is_overdue"])
        self.assertEqual(overdue[0]["days_open"], 10)
        search = self.client.get("/api/authority/issues/?search=Fresh").data["results"]
        self.assertEqual([i["id"] for i in search], [new.pk])
        unassigned = self.client.get("/api/authority/issues/?assigned_officer=unassigned").data["count"]
        self.assertEqual(unassigned, 2)
        today = timezone.localdate().isoformat()
        dated = self.client.get(f"/api/authority/issues/?date_from={today}").data["results"]
        self.assertEqual([i["id"] for i in dated], [new.pk])


class WorkflowTests(CivicEyeTestCase):
    def post(self, issue, action, data=None, fmt="json"):
        return self.client.post(f"/api/authority/issues/{issue.pk}/{action}/", data or {}, format=fmt)

    def resolve_payload(self, seed=500, lat=ISSUE_LAT, lng=ISSUE_LNG, source="CAMERA", images=True):
        data = {
            "resolution_description": "Garbage cleared and area disinfected.",
            "capture_source": source,
            "capture_latitude": str(lat),
            "capture_longitude": str(lng),
            "capture_accuracy_m": "6",
        }
        if images:
            data["images"] = [make_image(seed)]
        return data

    def test_full_resolution_flow(self):
        issue = self.create_issue()
        self.login(self.officer)
        ack = self.post(issue, "acknowledge", {"comment": "Team notified"})
        self.assertEqual(ack.data["status"], "ACKNOWLEDGED")
        started = self.post(issue, "start-work")
        self.assertEqual(started.data["status"], "IN_PROGRESS")
        resolved = self.post(issue, "resolve", self.resolve_payload(), fmt="multipart")
        self.assertEqual(resolved.status_code, 200, resolved.data)
        self.assertEqual(resolved.data["status"], "RESOLVED")
        resolution_images = [i for i in resolved.data["images"] if i["image_type"] == "RESOLUTION"]
        self.assertEqual(resolution_images[0]["proof_check_status"], "PASSED")
        self.assertLess(resolution_images[0]["distance_from_issue_m"], 1)
        # Original report image is preserved alongside the resolution image.
        self.assertTrue(any(i["image_type"] == "REPORT" for i in resolved.data["images"]))
        statuses = [h["new_status"] for h in resolved.data["history"]]
        self.assertEqual(statuses, ["SUBMITTED", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED"])
        types = set(Notification.objects.filter(recipient=self.citizen).values_list("notification_type", flat=True))
        self.assertTrue({"ISSUE_ACKNOWLEDGED", "WORK_STARTED", "VERIFICATION_REQUESTED"} <= types)

    def test_invalid_transitions_rejected(self):
        issue = self.create_issue()
        self.login(self.officer)
        self.assertError(self.post(issue, "start-work"), 400, "invalid_transition")
        self.assertError(self.post(issue, "resolve", self.resolve_payload(), fmt="multipart"), 400, "invalid_transition")
        self.assertError(self.post(issue, "reopen", {"reason": "x"}), 400, "invalid_transition")
        self.post(issue, "acknowledge")
        self.assertError(self.post(issue, "acknowledge"), 400, "invalid_transition")
        issue.refresh_from_db()
        self.assertEqual(issue.status, "ACKNOWLEDGED")
        self.assertEqual(issue.history.count(), 2)

    def test_resolution_photo_required(self):
        issue = self.create_issue()
        self.login(self.officer)
        self.post(issue, "acknowledge")
        self.post(issue, "start-work")
        response = self.post(issue, "resolve", self.resolve_payload(images=False), fmt="multipart")
        self.assertError(response, 400, "resolution_evidence_required")
        self.assertError(self.post(issue, "resolve", {**self.resolve_payload(), "resolution_description": ""}, fmt="multipart"), 400)

    def test_documented_exception_allows_resolution_without_photo(self):
        self.sanitation.allow_resolution_without_evidence = True
        self.sanitation.save()
        issue = self.create_issue()
        self.login(self.officer)
        self.post(issue, "acknowledge")
        self.post(issue, "start-work")
        response = self.post(issue, "resolve", self.resolve_payload(images=False), fmt="multipart")
        self.assertEqual(response.data["status"], "RESOLVED")

    def test_gallery_resolution_photo_rejected_unless_department_exception(self):
        issue = self.create_issue()
        self.login(self.officer)
        self.post(issue, "acknowledge")
        self.post(issue, "start-work")
        self.assertError(self.post(issue, "resolve", self.resolve_payload(source="GALLERY"), fmt="multipart"), 400, "camera_required")
        self.sanitation.allow_gallery_resolution = True
        self.sanitation.save()
        response = self.post(issue, "resolve", self.resolve_payload(source="GALLERY"), fmt="multipart")
        self.assertEqual(response.data["status"], "RESOLVED")

    def test_proof_lock_flags_distant_photo_until_supervisor_override(self):
        issue = self.create_issue()
        self.login(self.officer)
        self.post(issue, "acknowledge")
        self.post(issue, "start-work")
        far = self.resolve_payload(lat=Decimal("9.990000"), lng=Decimal("76.310000"))
        response = self.post(issue, "resolve", far, fmt="multipart")
        self.assertError(response, 409, "proof_check_flagged")
        flagged = response.data["error"]["details"]["images"][0]
        self.assertEqual(flagged["proof_check_status"], "FLAGGED")
        self.assertGreater(flagged["distance_from_issue_m"], 1000)
        issue.refresh_from_db()
        self.assertEqual(issue.status, "IN_PROGRESS")
        image = IssueImage.objects.get(pk=flagged["id"])

        # Officers cannot override their own flagged evidence.
        override_url = f"/api/authority/images/{image.pk}/override-proof-check/"
        self.assertError(self.client.post(override_url, {"reason": "trust me"}), 403)

        self.login(self.supervisor)
        self.assertError(self.client.post(override_url, {}), 400)
        ok = self.client.post(override_url, {"reason": "Verified by phone with the field crew; GPS drift in the underpass."})
        self.assertEqual(ok.data["proof_check_status"], "OVERRIDDEN")

        self.login(self.officer)
        response = self.post(issue, "resolve", self.resolve_payload(images=False), fmt="multipart")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "RESOLVED")

    def test_proof_lock_flags_reused_photo(self):
        issue = self.create_issue(seed=42)
        self.login(self.officer)
        self.post(issue, "acknowledge")
        self.post(issue, "start-work")
        response = self.post(issue, "resolve", self.resolve_payload(seed=42), fmt="multipart")
        self.assertError(response, 409, "proof_check_flagged")
        image = IssueImage.objects.get(pk=response.data["error"]["details"]["images"][0]["id"])
        self.assertIn("closely matches", image.proof_check_notes)

    def test_proof_lock_disabled(self):
        self.set_flag("proof_lock", enabled=False)
        issue = self.create_issue()
        self.login(self.officer)
        self.post(issue, "acknowledge")
        self.post(issue, "start-work")
        response = self.post(issue, "resolve", self.resolve_payload(lat=Decimal("10.1"), source="GALLERY"), fmt="multipart")
        self.assertEqual(response.data["status"], "RESOLVED")
        self.assertEqual(IssueImage.objects.get(issue=issue, image_type="RESOLUTION").proof_check_status, "NOT_APPLICABLE")

    def test_priority_change_requires_reason_and_is_recorded(self):
        issue = self.create_issue()
        original_due = issue.due_at
        self.login(self.officer)
        url = f"/api/authority/issues/{issue.pk}/priority/"
        self.assertError(self.client.patch(url, {"priority": "CRITICAL"}), 400, "validation_error")
        self.assertError(self.client.patch(url, {"priority": "URGENT", "reason": "x"}), 400, "validation_error")
        response = self.client.patch(url, {"priority": "CRITICAL", "reason": "Blocking the hospital entrance"})
        self.assertEqual(response.data["priority"], "CRITICAL")
        self.assertEqual(response.data["priority_changes"][0]["reason"], "Blocking the hospital entrance")
        change = IssuePriorityChange.objects.get()
        self.assertEqual((change.previous_priority, change.new_priority), ("MEDIUM", "CRITICAL"))
        issue.refresh_from_db()
        self.assertLess(issue.due_at, original_due)  # CRITICAL SLA (24h) is stricter than the 72h category SLA
        self.assertTrue(Notification.objects.filter(recipient=self.citizen, notification_type="PRIORITY_CHANGED").exists())
        # Status is unaffected by priority.
        self.assertEqual(issue.status, "SUBMITTED")

    def test_assignment_rules_and_history(self):
        issue = self.create_issue()
        other_sanitation = self.make_user("officer2", "OFFICER", self.sanitation, areas=[self.central])
        self.login(self.officer)
        url = f"/api/authority/issues/{issue.pk}/assign/"
        self.assertError(self.client.post(url, {"department_id": self.pwd.pk}), 403)
        self.assertError(self.client.post(url, {"department_id": self.sanitation.pk, "officer_id": self.pwd_officer.pk}), 400)
        response = self.client.post(url, {"department_id": self.sanitation.pk, "officer_id": other_sanitation.pk, "notes": "Your ward"})
        self.assertEqual(response.data["assigned_officer"]["id"], other_sanitation.pk)
        self.assertTrue(Notification.objects.filter(recipient=other_sanitation, notification_type="ISSUE_ASSIGNED").exists())

        self.login(self.supervisor)
        response = self.client.post(url, {"department_id": self.pwd.pk})
        self.assertEqual(response.data["department"]["name"], "Public Works")
        self.assertEqual(IssueAssignment.objects.filter(issue=issue).count(), 3)  # auto-route + 2 manual
        self.assertEqual(IssueAssignment.objects.filter(issue=issue, is_current=True).count(), 1)
        # After the transfer the original officer no longer has access.
        self.login(self.officer)
        self.assertError(self.client.get(f"/api/authority/issues/{issue.pk}/"), 404)

    def test_internal_comments_are_private(self):
        issue = self.create_issue()
        self.login(self.officer)
        self.post(issue, "comments", {"comment": "Contractor is unreliable", "visibility": "INTERNAL"})
        self.post(issue, "comments", {"comment": "Crew scheduled for tomorrow", "visibility": "CITIZEN_VISIBLE"})
        self.assertEqual(len(self.client.get(f"/api/authority/issues/{issue.pk}/").data["comments"]), 2)

        self.login(self.citizen)
        detail = self.client.get(f"/api/issues/{issue.pk}/").data
        comments = self.client.get(f"/api/issues/{issue.pk}/comments/").data
        for payload in (detail["comments"], comments):
            self.assertEqual([c["comment"] for c in payload], ["Crew scheduled for tomorrow"])
        self.assertNotIn("Contractor", str(detail))
        self.assertEqual(Notification.objects.filter(recipient=self.citizen, notification_type="NEW_COMMENT").count(), 1)
        self.assertEqual(IssueComment.objects.count(), 2)

    def test_admin_close_requires_admin_and_reason(self):
        issue = self.create_issue()
        self.login(self.supervisor)
        self.assertError(self.post(issue, "close", {"reason": "Spam"}), 403)
        self.login(self.admin)
        self.assertError(self.post(issue, "close"), 400)
        response = self.post(issue, "close", {"reason": "Duplicate of CE-2026-000001"})
        self.assertEqual(response.data["status"], "CLOSED")
        self.assertEqual(response.data["closure_type"], "ADMIN_CLOSED")


class DashboardAndReportTests(CivicEyeTestCase):
    def test_dashboard_uses_real_scoped_data(self):
        self.create_issue(seed=1)
        self.resolve_issue(self.create_issue(seed=2))
        self.create_issue(category=self.pothole, seed=3)
        self.login(self.officer)
        data = self.client.get("/api/authority/dashboard/").data
        self.assertEqual(data["kpis"]["total"], 2)
        self.assertEqual(data["kpis"]["awaiting_review"], 1)
        self.assertEqual(data["kpis"]["awaiting_verification"], 1)
        self.assertEqual(sum(p["value"] for p in data["by_status"]), 2)
        self.assertEqual(data["by_category"], [{"label": "Garbage", "value": 2}])
        self.assertEqual(sum(p["reported"] for p in data["trend"]["points"]), 2)
        self.assertEqual(data["resolution_time"]["sample_size"], 1)
        monthly = self.client.get("/api/authority/dashboard/?period=monthly").data
        self.assertEqual(len(monthly["trend"]["points"]), 6)

    def test_csv_export(self):
        issue = self.create_issue(title="=HYPERLINK(evil) garbage")
        self.login(self.officer)
        response = self.client.get("/api/authority/reports/?export=csv&status=SUBMITTED")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "text/csv; charset=utf-8")
        rows = list(csv.reader(io.StringIO(response.content.decode())))
        self.assertEqual(rows[0][0], "Complaint ID")
        self.assertEqual(rows[1][0], issue.complaint_id)
        self.assertTrue(rows[1][1].startswith("'="))

    def test_report_summary(self):
        self.create_issue()
        self.login(self.officer)
        data = self.client.get("/api/authority/reports/").data
        self.assertEqual(data["total"], 1)
        self.assertEqual(data["departments"][0]["department"], "Sanitation")
