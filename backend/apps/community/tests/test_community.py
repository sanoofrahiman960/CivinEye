from datetime import timedelta

from django.utils import timezone

from apps.community.models import DurabilityCheck, IssueSupport
from apps.core.jobs import run_scheduled_jobs
from apps.core.tests.helpers import ISSUE_LAT, ISSUE_LNG, CivicEyeTestCase, make_image
from apps.issues import services
from apps.issues.models import Issue
from apps.notifications.models import Notification


class AffectsMeTooTests(CivicEyeTestCase):
    def support(self, issue, lat=ISSUE_LAT, lng=ISSUE_LNG):
        return self.client.post(f"/api/issues/{issue.pk}/support/", {"latitude": str(lat), "longitude": str(lng)})

    def test_support_increments_impact_and_subscribes(self):
        issue = self.create_issue()
        self.login(self.other_citizen)
        response = self.support(issue)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertTrue(response.data["supported_by_me"])
        self.assertEqual(response.data["impact_count"], 1)
        services.acknowledge(issue, self.officer)
        self.assertTrue(
            Notification.objects.filter(recipient=self.other_citizen, notification_type="ISSUE_ACKNOWLEDGED").exists()
        )

    def test_support_rules(self):
        issue = self.create_issue()
        self.login(self.citizen)
        self.assertError(self.support(issue), 400, "own_issue")
        self.login(self.other_citizen)
        self.assertError(self.support(issue, lat="10.300000"), 400, "too_far")
        self.support(issue)
        self.assertError(self.support(issue), 400, "already_supported")
        self.assertEqual(IssueSupport.objects.count(), 1)
        removed = self.client.delete(f"/api/issues/{issue.pk}/support/")
        self.assertEqual(removed.data["impact_count"], 0)

    def test_impact_raises_recommended_priority(self):
        self.set_flag("affects_me_too", enabled=True, impact_bump_threshold=1, max_distance_m=2000)
        issue = self.create_issue()
        self.assertEqual(issue.recommended_priority, "MEDIUM")
        self.login(self.other_citizen)
        self.support(issue)
        issue.refresh_from_db()
        self.assertEqual(issue.recommended_priority, "HIGH")
        self.assertEqual(issue.priority, "MEDIUM")  # the official priority is still the officer's decision

    def test_feature_flag_disables_endpoint(self):
        self.set_flag("affects_me_too", enabled=False)
        issue = self.create_issue()
        self.login(self.other_citizen)
        self.assertError(self.support(issue), 403, "feature_disabled")

    def test_nearby_suggests_open_issues_from_others(self):
        nearby = self.create_issue(self.citizen, seed=1)
        self.create_issue(self.citizen, category=self.pothole, seed=2)
        self.create_issue(self.citizen, seed=3, lat="10.150000", lng="76.280000")
        self.login(self.other_citizen)
        response = self.client.get(f"/api/issues/nearby/?lat={ISSUE_LAT}&lng={ISSUE_LNG}&category={self.garbage.pk}")
        self.assertEqual([i["id"] for i in response.data], [nearby.pk])
        self.assertEqual(response.data[0]["distance_m"], 0)
        self.assertNotIn("reporter", response.data[0])
        self.login(self.citizen)
        own = self.client.get(f"/api/issues/nearby/?lat={ISSUE_LAT}&lng={ISSUE_LNG}")
        self.assertEqual(own.data, [])

    def test_map_returns_public_safe_markers(self):
        issue = self.create_issue()
        self.login(self.other_citizen)
        response = self.client.get("/api/issues/map/?min_lat=9.9&max_lat=10.1&min_lng=76.2&max_lng=76.4&priority=MEDIUM")
        self.assertEqual(len(response.data), 1)
        marker = response.data[0]
        self.assertEqual(marker["id"], issue.pk)
        self.assertFalse(marker["is_mine"])
        self.assertEqual(set(marker), {
            "id", "complaint_id", "title", "category", "status", "priority", "latitude", "longitude",
            "thumbnail_url", "impact_count", "is_mine", "created_at",
        })


class DurabilityCheckTests(CivicEyeTestCase):
    def closed_issue(self):
        issue = self.resolve_issue(self.create_issue())
        IssueSupport.objects.create(issue=issue, user=self.other_citizen, latitude=ISSUE_LAT, longitude=ISSUE_LNG)
        services.confirm_resolution(issue, self.citizen)
        DurabilityCheck.objects.update(due_at=timezone.now() - timedelta(minutes=1))
        return issue

    def test_checks_sent_once_to_reporter_and_supporters(self):
        issue = self.closed_issue()
        self.assertEqual(run_scheduled_jobs()["durability_sent"], 2)
        self.assertEqual(run_scheduled_jobs()["durability_sent"], 0)
        for user in (self.citizen, self.other_citizen):
            self.assertEqual(
                Notification.objects.filter(recipient=user, issue=issue, notification_type="DURABILITY_CHECK").count(), 1
            )
        self.login(self.citizen)
        pending = self.client.get("/api/durability-checks/").data
        self.assertEqual([c["issue"]["id"] for c in pending], [issue.pk])

    def test_still_fixed(self):
        issue = self.closed_issue()
        run_scheduled_jobs()
        self.login(self.citizen)
        response = self.client.post(f"/api/issues/{issue.pk}/durability-response/", {"response": "STILL_FIXED"})
        self.assertEqual(response.data, {"response": "STILL_FIXED", "follow_up_issue": None})
        self.assertError(
            self.client.post(f"/api/issues/{issue.pk}/durability-response/", {"response": "STILL_FIXED"}), 400, "check_closed"
        )

    def test_not_answerable_before_it_is_sent(self):
        issue = self.closed_issue()
        self.login(self.citizen)
        self.assertError(
            self.client.post(f"/api/issues/{issue.pk}/durability-response/", {"response": "STILL_FIXED"}), 400, "check_closed"
        )

    def test_problem_returned_creates_linked_recurrence(self):
        issue = self.closed_issue()
        run_scheduled_jobs()
        self.login(self.citizen)
        url = f"/api/issues/{issue.pk}/durability-response/"
        self.assertError(self.client.post(url, {"response": "PROBLEM_RETURNED"}), 400, "validation_error")
        response = self.client.post(
            url, {"response": "PROBLEM_RETURNED", "note": "Dumped again", "images": [make_image(88)]}, format="multipart"
        )
        self.assertEqual(response.status_code, 200, response.data)
        follow_up = Issue.objects.get(pk=response.data["follow_up_issue"]["id"])
        self.assertEqual(follow_up.parent_issue, issue)
        self.assertTrue(follow_up.is_recurrence)
        self.assertEqual(follow_up.status, "SUBMITTED")
        self.assertEqual(follow_up.recommended_priority, "HIGH")  # one level above the original MEDIUM
        issue.refresh_from_db()
        self.assertEqual(issue.status, "CLOSED")  # the original stays closed
        self.assertTrue(Notification.objects.filter(recipient=self.officer, notification_type="RECURRENCE_REPORTED").exists())

        # A second "problem returned" joins the existing recurrence instead of duplicating it.
        self.login(self.other_citizen)
        second = self.client.post(url, {"response": "PROBLEM_RETURNED", "images": [make_image(89)]}, format="multipart")
        self.assertEqual(second.data["follow_up_issue"]["id"], follow_up.pk)
        self.assertEqual(Issue.objects.filter(parent_issue=issue).count(), 1)
        follow_up.refresh_from_db()
        self.assertEqual(follow_up.impact_count, 1)

    def test_admin_closed_issues_get_no_checks(self):
        issue = self.create_issue()
        services.admin_close(issue, self.admin, "Duplicate")
        self.assertFalse(DurabilityCheck.objects.exists())

    def test_unanswered_checks_expire(self):
        self.closed_issue()
        run_scheduled_jobs()
        DurabilityCheck.objects.update(sent_at=timezone.now() - timedelta(days=15))
        self.assertEqual(run_scheduled_jobs()["durability_expired"], 2)
