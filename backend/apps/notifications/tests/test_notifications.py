from unittest import mock

from django.test import override_settings

from apps.core.tests.helpers import CivicEyeTestCase
from apps.notifications.models import DeviceToken, Notification
from apps.notifications.services import notify


class NotificationTests(CivicEyeTestCase):
    def test_notify_is_idempotent(self):
        first = notify(self.citizen, "ISSUE_CLOSED", "Closed", "Done", dedupe_key="event:1")
        second = notify(self.citizen, "ISSUE_CLOSED", "Closed", "Done", dedupe_key="event:1")
        self.assertEqual(first.pk, second.pk)
        self.assertEqual(Notification.objects.count(), 1)

    def test_list_read_and_read_all(self):
        notify(self.citizen, "ISSUE_CLOSED", "One", "x", dedupe_key="a")
        notify(self.citizen, "ISSUE_CLOSED", "Two", "x", dedupe_key="b")
        notify(self.other_citizen, "ISSUE_CLOSED", "Not yours", "x", dedupe_key="c")
        self.login(self.citizen)
        listing = self.client.get("/api/notifications/").data
        self.assertEqual(listing["count"], 2)
        self.assertEqual(self.client.get("/api/notifications/unread-count/").data["unread"], 2)
        first_id = listing["results"][0]["id"]
        self.assertTrue(self.client.patch(f"/api/notifications/{first_id}/read/").data["is_read"])
        other = Notification.objects.get(recipient=self.other_citizen)
        self.assertError(self.client.patch(f"/api/notifications/{other.pk}/read/"), 404)
        self.assertEqual(self.client.post("/api/notifications/read-all/").data["updated"], 1)
        self.assertEqual(self.client.get("/api/notifications/?unread=true").data["count"], 0)

    def test_issue_events_create_notifications(self):
        issue = self.create_issue()
        self.resolve_issue(issue)
        types = list(
            Notification.objects.filter(recipient=self.citizen).order_by("id").values_list("notification_type", flat=True)
        )
        self.assertEqual(types, ["ISSUE_SUBMITTED", "ISSUE_ACKNOWLEDGED", "WORK_STARTED", "VERIFICATION_REQUESTED"])

    def test_device_registration(self):
        self.login(self.citizen)
        token = "ExponentPushToken[abc123]"
        self.assertEqual(self.client.post("/api/notifications/devices/", {"token": token, "platform": "android"}).status_code, 204)
        self.assertTrue(DeviceToken.objects.get(token=token).is_active)
        self.client.delete("/api/notifications/devices/", {"token": token}, format="json")
        self.assertFalse(DeviceToken.objects.get(token=token).is_active)

    @override_settings(EXPO_PUSH_ENABLED=True)
    def test_push_sent_through_expo_and_dead_tokens_disabled(self):
        DeviceToken.objects.create(user=self.citizen, token="ExponentPushToken[dead]", platform="ios")
        response = mock.Mock()
        response.json.return_value = {"data": [{"status": "error", "details": {"error": "DeviceNotRegistered"}}]}
        with mock.patch("apps.notifications.tasks.requests.post", return_value=response) as post:
            with self.captureOnCommitCallbacks(execute=True):
                notify(self.citizen, "ISSUE_CLOSED", "Closed", "Done", dedupe_key="push:1")
        self.assertEqual(post.call_count, 1)
        self.assertEqual(post.call_args.kwargs["json"][0]["to"], "ExponentPushToken[dead]")
        self.assertFalse(DeviceToken.objects.get().is_active)
