import io
import uuid
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone
from PIL import Image

from apps.assignments.models import IssueAssignment
from apps.audit.models import AuditLog
from apps.core.tests.helpers import CivicEyeTestCase, make_image
from apps.issues.models import Issue, IssueImage, IssueSubcategory
from apps.notifications.models import Notification


class CreateIssueTests(CivicEyeTestCase):
    url = "/api/issues/"

    def payload(self, **overrides):
        return {
            "title": "Garbage near the bus stop",
            "description": "A large pile of garbage near the bus stop is attracting stray dogs.",
            "category": self.garbage.pk,
            "latitude": "9.98161234567",
            "longitude": "76.29991234567",
            "address": "MG Road bus stop",
            "location_accuracy_m": "6.5",
            "reported_urgency": "HIGH",
            **overrides,
        }

    def post(self, images=None, **overrides):
        data = self.payload(**overrides)
        data["images"] = images if images is not None else [make_image(1)]
        return self.client.post(self.url, data, format="multipart")

    def test_citizen_creates_issue(self):
        self.login(self.citizen)
        response = self.post(images=[make_image(1), make_image(2)])
        self.assertEqual(response.status_code, 201, response.data)
        data = response.data
        self.assertRegex(data["complaint_id"], r"^CE-\d{4}-\d{6}$")
        self.assertEqual(data["status"], "SUBMITTED")
        self.assertEqual(data["department"]["name"], "Sanitation")
        self.assertEqual(len(data["images"]), 2)
        self.assertTrue(data["is_owner"])
        self.assertEqual(data["history"][0]["new_status"], "SUBMITTED")

        issue = Issue.objects.get(pk=data["id"])
        self.assertEqual(str(issue.latitude), "9.981612")
        self.assertEqual(issue.service_area, self.central)
        self.assertEqual(issue.reported_urgency, "HIGH")
        # Citizen urgency is a signal: MEDIUM category default is bumped one level at most.
        self.assertEqual(issue.recommended_priority, "HIGH")
        self.assertIsNotNone(issue.due_at)
        self.assertTrue(IssueAssignment.objects.filter(issue=issue, is_current=True, department=self.sanitation).exists())
        self.assertTrue(Notification.objects.filter(recipient=self.citizen, notification_type="ISSUE_SUBMITTED").exists())
        self.assertTrue(Notification.objects.filter(recipient=self.officer, notification_type="NEW_ISSUE").exists())
        self.assertFalse(Notification.objects.filter(recipient=self.pwd_officer).exists())
        self.assertTrue(AuditLog.objects.filter(action="issue.created", entity_id=str(issue.pk)).exists())

    def test_photo_is_required(self):
        self.login(self.citizen)
        response = self.post(images=[])
        self.assertError(response, 400, "validation_error")
        self.assertIn("images", response.data["error"]["details"])

    def test_required_fields(self):
        self.login(self.citizen)
        response = self.client.post(self.url, {"images": [make_image(1)]}, format="multipart")
        self.assertError(response, 400, "validation_error")
        for field in ("title", "description", "category", "latitude", "longitude"):
            self.assertIn(field, response.data["error"]["details"])

    def test_invalid_coordinates(self):
        self.login(self.citizen)
        self.assertError(self.post(latitude="95"), 400, "validation_error")

    def test_subcategory_must_match_category(self):
        sub = IssueSubcategory.objects.create(category=self.pothole, name="Edge damage")
        self.login(self.citizen)
        self.assertError(self.post(subcategory=sub.pk), 400, "validation_error")

    def test_non_image_file_rejected(self):
        self.login(self.citizen)
        fake = SimpleUploadedFile("evil.jpg", b"<?php echo 'not an image'; ?>", content_type="image/jpeg")
        self.assertError(self.post(images=[fake]), 400, "validation_error")
        self.assertFalse(Issue.objects.exists())

    def test_unsupported_image_format_rejected(self):
        self.login(self.citizen)
        buffer = io.BytesIO()
        Image.new("RGB", (50, 50)).save(buffer, format="GIF")
        gif = SimpleUploadedFile("a.gif", buffer.getvalue(), content_type="image/gif")
        self.assertError(self.post(images=[gif]), 400, "validation_error")

    @override_settings(MAX_IMAGE_SIZE_MB=1)
    def test_oversized_image_rejected(self):
        self.login(self.citizen)
        big = SimpleUploadedFile("big.jpg", b"\xff" * (1024 * 1024 + 10), content_type="image/jpeg")
        response = self.post(images=[big])
        self.assertError(response, 400, "validation_error")
        self.assertIn("1 MB", response.data["error"]["message"])

    def test_too_many_images_rejected(self):
        self.login(self.citizen)
        self.assertError(self.post(images=[make_image(i) for i in range(6)]), 400, "validation_error")

    def test_exif_metadata_is_stripped(self):
        exif = Image.Exif()
        exif[0x010F] = "SecretCam"  # Make
        self.login(self.citizen)
        response = self.post(images=[make_image(3, exif=exif)])
        self.assertEqual(response.status_code, 201)
        stored = IssueImage.objects.get(issue_id=response.data["id"])
        with Image.open(stored.image.path) as img:
            self.assertEqual(len(img.getexif()), 0)
        self.assertEqual(len(stored.perceptual_hash), 16)

    def test_resubmitting_same_client_submission_id_is_idempotent(self):
        self.login(self.citizen)
        submission_id = str(uuid.uuid4())
        first = self.post(client_submission_id=submission_id)
        second = self.post(client_submission_id=submission_id)
        self.assertEqual(first.status_code, 201)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(Issue.objects.count(), 1)

    def test_offline_capture_time_validated(self):
        self.login(self.citizen)
        too_old = (timezone.now() - timedelta(hours=100)).isoformat()
        self.assertError(self.post(client_reported_at=too_old), 400, "validation_error")
        future = (timezone.now() + timedelta(hours=2)).isoformat()
        self.assertError(self.post(client_reported_at=future), 400, "validation_error")
        recent = (timezone.now() - timedelta(hours=3)).isoformat()
        response = self.post(client_reported_at=recent)
        self.assertEqual(response.status_code, 201)
        self.assertIsNotNone(Issue.objects.get().client_reported_at)

    def test_authority_cannot_use_citizen_reporting(self):
        self.login(self.officer)
        self.assertError(self.post(), 403)


class CitizenAccessTests(CivicEyeTestCase):
    def test_my_issues_only_lists_own(self):
        mine = self.create_issue(self.citizen, seed=1)
        self.create_issue(self.other_citizen, seed=2)
        self.login(self.citizen)
        response = self.client.get("/api/issues/my/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual([i["id"] for i in response.data["results"]], [mine.pk])
        self.assertIsNotNone(response.data["results"][0]["thumbnail_url"])

    def test_my_issues_filter_and_search(self):
        first = self.create_issue(self.citizen, seed=1, title="Overflowing bin at market")
        self.create_issue(self.citizen, seed=2, title="Garbage at park")
        self.resolve_issue(first)
        self.login(self.citizen)
        resolved = self.client.get("/api/issues/my/?status=RESOLVED")
        self.assertEqual([i["id"] for i in resolved.data["results"]], [first.pk])
        search = self.client.get("/api/issues/my/?search=park")
        self.assertEqual(len(search.data["results"]), 1)
        by_id = self.client.get(f"/api/issues/my/?search={first.complaint_id}")
        self.assertEqual(by_id.data["results"][0]["id"], first.pk)

    def test_summary_counts(self):
        self.create_issue(self.citizen, seed=1)
        self.resolve_issue(self.create_issue(self.citizen, seed=2))
        self.login(self.citizen)
        data = self.client.get("/api/issues/my/summary/").data
        self.assertEqual(data["counts"]["total"], 2)
        self.assertEqual(data["counts"]["open"], 1)
        self.assertEqual(data["counts"]["awaiting_verification"], 1)

    def test_other_citizen_sees_only_public_view(self):
        issue = self.create_issue(self.citizen)
        from apps.issues.services import add_comment

        add_comment(issue, self.citizen, "My phone is +919999999999, call me")
        self.login(self.other_citizen)
        data = self.client.get(f"/api/issues/{issue.pk}/").data
        self.assertFalse(data["is_owner"])
        for private in ("reporter", "comments", "additional_details", "assigned_officer_name", "can_reopen"):
            self.assertNotIn(private, data)
        self.assertNotIn("+919999999999", str(data))
        self.assertEqual(data["latitude"], 9.982)
        self.assertNotIn("reason", data["history"][0])

    def test_other_citizen_cannot_act_on_issue(self):
        issue = self.resolve_issue(self.create_issue(self.citizen))
        self.login(self.other_citizen)
        self.assertError(self.client.post(f"/api/issues/{issue.pk}/reopen/", {"reason": "Not fixed"}), 404)
        self.assertError(self.client.post(f"/api/issues/{issue.pk}/confirm-resolution/", {}), 404)
        self.assertError(self.client.get(f"/api/issues/{issue.pk}/history/"), 404)
        self.assertError(self.client.get(f"/api/issues/{issue.pk}/comments/"), 404)
        self.assertError(
            self.client.post(f"/api/issues/{issue.pk}/additional-evidence/", {"images": [make_image(9)]}, format="multipart"),
            404,
        )
        issue.refresh_from_db()
        self.assertEqual(issue.status, "RESOLVED")

    def test_citizen_cannot_access_authority_endpoints(self):
        issue = self.create_issue(self.citizen)
        self.login(self.citizen)
        for method, url in [
            ("get", "/api/authority/dashboard/"),
            ("get", "/api/authority/issues/"),
            ("get", f"/api/authority/issues/{issue.pk}/"),
            ("post", f"/api/authority/issues/{issue.pk}/acknowledge/"),
            ("patch", f"/api/authority/issues/{issue.pk}/priority/"),
            ("get", "/api/authority/reports/"),
        ]:
            self.assertError(getattr(self.client, method)(url, {}), 403)
        issue.refresh_from_db()
        self.assertEqual(issue.status, "SUBMITTED")

    def test_additional_evidence(self):
        issue = self.create_issue(self.citizen)
        self.login(self.citizen)
        response = self.client.post(
            f"/api/issues/{issue.pk}/additional-evidence/",
            {"images": [make_image(7)], "caption": "Worse today"},
            format="multipart",
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data[0]["image_type"], "ADDITIONAL_EVIDENCE")
        self.assertTrue(Notification.objects.filter(recipient=self.officer, notification_type="NEW_COMMENT").exists())

    def test_citizen_comments(self):
        issue = self.create_issue(self.citizen)
        self.login(self.citizen)
        response = self.client.post(f"/api/issues/{issue.pk}/comments/", {"comment": "Still there", "visibility": "INTERNAL"})
        self.assertEqual(response.status_code, 201)
        # Citizens can never create internal comments.
        self.assertEqual(response.data["visibility"], "CITIZEN_VISIBLE")

    def test_reference_data_endpoints(self):
        self.login(self.citizen)
        categories = self.client.get("/api/issue-categories/")
        self.assertEqual({c["slug"] for c in categories.data}, {"garbage", "pothole", "live-wire"})
        self.assertEqual(self.client.get("/api/departments/").status_code, 200)
        self.client.force_authenticate(user=None)
        config = self.client.get("/api/configuration/")
        self.assertEqual(config.status_code, 200)
        self.assertIn("proof_lock", config.data["features"])
        self.assertTrue(any(s["value"] == "RESOLVED" for s in config.data["choices"]["statuses"]))
