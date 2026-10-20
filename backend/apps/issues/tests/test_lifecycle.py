from datetime import timedelta

from django.utils import timezone

from apps.community.models import DurabilityCheck
from apps.core.jobs import run_scheduled_jobs
from apps.core.models import PlatformConfiguration
from apps.core.tests.helpers import CivicEyeTestCase, make_image
from apps.issues import services
from apps.issues.models import Issue
from apps.notifications.models import Notification


class CitizenVerificationTests(CivicEyeTestCase):
    def test_confirm_resolution_closes_issue(self):
        issue = self.resolve_issue(self.create_issue())
        self.login(self.citizen)
        response = self.client.post(f"/api/issues/{issue.pk}/confirm-resolution/", {"rating": 4, "comment": "Thanks"})
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "CLOSED")
        self.assertEqual(response.data["closure_type"], "CITIZEN_CONFIRMED")
        self.assertEqual(response.data["satisfaction_rating"], 4)
        self.assertFalse(response.data["can_confirm"])
        self.assertTrue(response.data["can_reopen"])  # still inside the reopen window
        self.assertTrue(DurabilityCheck.objects.filter(issue=issue, recipient=self.citizen).exists())
        self.assertTrue(Notification.objects.filter(recipient=self.officer, notification_type="ISSUE_CLOSED").exists())

    def test_confirm_only_when_awaiting_verification(self):
        issue = self.create_issue()
        self.login(self.citizen)
        self.assertError(self.client.post(f"/api/issues/{issue.pk}/confirm-resolution/", {}), 400, "invalid_transition")
        self.assertError(self.client.post(f"/api/issues/{issue.pk}/confirm-resolution/", {"rating": 9}), 400, "validation_error")

    def test_reopen_preserves_history_and_evidence(self):
        issue = self.resolve_issue(self.create_issue())
        self.login(self.citizen)
        self.assertError(self.client.post(f"/api/issues/{issue.pk}/reopen/", {"reason": "  "}), 400, "validation_error")
        response = self.client.post(
            f"/api/issues/{issue.pk}/reopen/",
            {"reason": "Garbage is back the next day", "images": [make_image(77)]},
            format="multipart",
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["status"], "REOPENED")
        self.assertEqual(response.data["reopen_count"], 1)
        image_types = sorted(i["image_type"] for i in response.data["images"])
        self.assertEqual(image_types, ["REOPEN_EVIDENCE", "REPORT", "RESOLUTION"])
        statuses = [h["new_status"] for h in response.data["history"]]
        self.assertEqual(statuses, ["SUBMITTED", "ACKNOWLEDGED", "IN_PROGRESS", "RESOLVED", "REOPENED"])
        self.assertEqual(response.data["history"][-1]["reason"], "Garbage is back the next day")
        self.assertTrue(Notification.objects.filter(recipient=self.officer, notification_type="ISSUE_REOPENED").exists())

        issue.refresh_from_db()
        self.assertEqual(issue.resolution_cycle, 2)
        self.assertIsNotNone(issue.reopened_at)

    def test_reopened_issue_needs_new_resolution_evidence(self):
        issue = self.resolve_issue(self.create_issue())
        services.citizen_reopen(issue, self.citizen, "Not fixed")
        issue.refresh_from_db()
        services.start_work(issue, self.officer)
        self.login(self.officer)
        response = self.client.post(
            f"/api/authority/issues/{issue.pk}/resolve/",
            {"resolution_description": "Done again", "capture_source": "CAMERA"},
            format="multipart",
        )
        self.assertError(response, 400, "resolution_evidence_required")

    def test_reopen_rules(self):
        issue = self.create_issue()
        self.login(self.citizen)
        self.assertError(self.client.post(f"/api/issues/{issue.pk}/reopen/", {"reason": "x"}), 400, "invalid_transition")

        closed = self.resolve_issue(self.create_issue(seed=5))
        services.confirm_resolution(closed, self.citizen)
        window = PlatformConfiguration.load().citizen_reopen_window_days
        Issue.objects.filter(pk=closed.pk).update(closed_at=timezone.now() - timedelta(days=window + 1))
        self.assertError(self.client.post(f"/api/issues/{closed.pk}/reopen/", {"reason": "Broken again"}), 400, "invalid_transition")

    def test_reopen_from_closed_cancels_durability_checks(self):
        issue = self.resolve_issue(self.create_issue())
        services.confirm_resolution(issue, self.citizen)
        self.login(self.citizen)
        self.client.post(f"/api/issues/{issue.pk}/reopen/", {"reason": "It flooded again"})
        self.assertEqual(DurabilityCheck.objects.get(issue=issue).response, "CANCELLED")

    def test_authority_reopen(self):
        issue = self.resolve_issue(self.create_issue())
        self.login(self.officer)
        self.assertError(self.client.post(f"/api/authority/issues/{issue.pk}/reopen/", {}), 400)
        response = self.client.post(f"/api/authority/issues/{issue.pk}/reopen/", {"reason": "Follow-up disinfection needed"})
        self.assertEqual(response.data["status"], "REOPENED")
        self.assertTrue(Notification.objects.filter(recipient=self.citizen, notification_type="ISSUE_REOPENED").exists())


class ScheduledJobTests(CivicEyeTestCase):
    def test_verification_timeout_closes_as_auto_timeout(self):
        issue = self.resolve_issue(self.create_issue())
        Issue.objects.filter(pk=issue.pk).update(resolved_at=timezone.now() - timedelta(days=8))
        results = run_scheduled_jobs()
        self.assertEqual(results["auto_closed"], 1)
        issue.refresh_from_db()
        self.assertEqual(issue.status, "CLOSED")
        self.assertEqual(issue.closure_type, "AUTO_TIMEOUT")
        last = issue.history.last()
        self.assertIsNone(last.changed_by)
        self.assertIn("not confirmed by the reporter", last.reason)

    def test_verification_timeout_can_be_disabled(self):
        config = PlatformConfiguration.load()
        config.auto_close_on_verification_timeout = False
        config.save()
        issue = self.resolve_issue(self.create_issue())
        Issue.objects.filter(pk=issue.pk).update(resolved_at=timezone.now() - timedelta(days=30))
        run_scheduled_jobs()
        issue.refresh_from_db()
        self.assertEqual(issue.status, "RESOLVED")

    def test_sla_due_dates(self):
        issue = self.create_issue()
        # MEDIUM priority allows 168h but the category SLA (72h) is stricter.
        self.assertAlmostEqual((issue.due_at - issue.created_at).total_seconds() / 3600, 72)
        self.assertAlmostEqual((issue.ack_due_at - issue.created_at).total_seconds() / 3600, 24)

    def test_overdue_marked_once_and_cleared_on_resolution(self):
        issue = self.create_issue()
        Issue.objects.filter(pk=issue.pk).update(ack_due_at=timezone.now() - timedelta(hours=1))
        run_scheduled_jobs()
        run_scheduled_jobs()
        issue.refresh_from_db()
        self.assertTrue(issue.is_overdue)
        self.assertEqual(
            Notification.objects.filter(recipient=self.officer, notification_type="SLA_BREACH").count(), 1
        )
        self.assertTrue(Notification.objects.filter(recipient=self.supervisor, notification_type="SLA_BREACH").exists())

        self.resolve_issue(issue)
        run_scheduled_jobs()
        issue.refresh_from_db()
        self.assertFalse(issue.is_overdue)

    def test_life_threatening_category_fast_lane(self):
        issue = self.create_issue(category=self.live_wire, title="Live wire on the road")
        self.assertEqual(issue.priority, "CRITICAL")
        self.assertAlmostEqual((issue.ack_due_at - issue.created_at).total_seconds() / 3600, 1)
        self.assertTrue(
            Notification.objects.filter(recipient=self.pwd_officer, notification_type="LIFE_SAFETY_ALERT").exists()
        )

    def test_priority_rules_apply_only_when_configured(self):
        config = PlatformConfiguration.load()
        config.auto_apply_priority_rules = False
        config.save()
        issue = self.create_issue()
        self.assertEqual(issue.priority, "UNCLASSIFIED")
        self.assertEqual(issue.recommended_priority, "MEDIUM")
