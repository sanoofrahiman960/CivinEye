import re
from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone

from apps.accounts.models import PhoneOTP, Role, User
from apps.accounts.sms import LocmemSMSBackend, SMSDeliveryError
from apps.audit.models import AuditLog
from apps.core.tests.helpers import CivicEyeTestCase


class OTPTestCase(CivicEyeTestCase):
    def setUp(self):
        super().setUp()
        LocmemSMSBackend.outbox.clear()

    def request(self, phone="98123 45678"):
        return self.client.post("/api/auth/otp/request/", {"phone_number": phone}, format="json")

    def last_code(self):
        return re.search(r"^(\d{6}) is your CivicEye", LocmemSMSBackend.outbox[-1]["message"]).group(1)

    def verify(self, code, phone="+919812345678", full_name=None):
        body = {"phone_number": phone, "code": code}
        if full_name is not None:
            body["full_name"] = full_name
        return self.client.post("/api/auth/otp/verify/", body, format="json")


class OTPRequestTests(OTPTestCase):
    def test_sends_sms_and_stores_only_a_hash(self):
        response = self.request("098123-45678")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["phone_number"], "+919812345678")
        self.assertEqual(response.data["resend_after"], 60)
        self.assertNotIn("code", response.data)
        self.assertEqual(LocmemSMSBackend.outbox[-1]["to"], "+919812345678")
        code = self.last_code()
        otp = PhoneOTP.objects.get()
        self.assertNotIn(code, otp.code_hash)
        self.assertIn("•", response.data["detail"])  # number is masked in the message

    def test_rejects_invalid_numbers(self):
        self.assertError(self.request("12ab"), 400, "validation_error")
        self.assertFalse(LocmemSMSBackend.outbox)

    def test_resend_cooldown_and_hourly_limit(self):
        self.request()
        response = self.request()
        self.assertError(response, 429, "otp_cooldown")
        self.assertGreater(response.data["error"]["details"]["retry_after"], 0)

        PhoneOTP.objects.update(created_at=timezone.now() - timedelta(minutes=2))
        self.assertEqual(self.request().status_code, 200)
        # Older codes stop working once a new one is sent.
        self.assertEqual(PhoneOTP.objects.filter(consumed_at__isnull=True).count(), 1)

        PhoneOTP.objects.update(created_at=timezone.now() - timedelta(minutes=2))
        for _ in range(3):
            self.request()
            PhoneOTP.objects.update(created_at=timezone.now() - timedelta(minutes=2))
        self.assertError(self.request(), 429, "otp_limit")

    def test_sms_failure_returns_503_and_leaves_no_usable_code(self):
        with mock.patch("apps.accounts.sms.LocmemSMSBackend.send", side_effect=SMSDeliveryError("down")):
            self.assertError(self.request(), 503, "sms_failed")
        self.assertFalse(PhoneOTP.objects.exists())


class OTPVerifyTests(OTPTestCase):
    def test_new_number_asks_for_name_then_creates_citizen(self):
        self.request()
        code = self.last_code()

        first = self.verify(code)
        self.assertEqual(first.status_code, 200)
        self.assertEqual(first.data["status"], "name_required")
        self.assertFalse(User.objects.filter(phone_number="+919812345678").exists())

        second = self.verify(code, full_name="Anita Nair")
        self.assertEqual(second.status_code, 201, second.data)
        self.assertEqual(second.data["status"], "authenticated")
        self.assertTrue(second.data["is_new_user"])
        self.assertIn("access", second.data)
        user = User.objects.get(phone_number="+919812345678")
        self.assertEqual((user.role, user.full_name, user.email), (Role.CITIZEN, "Anita Nair", None))
        self.assertFalse(user.has_usable_password())
        self.assertTrue(AuditLog.objects.filter(action="user.registered", entity_id=str(user.pk)).exists())

        # The code is single-use.
        self.assertError(self.verify(code), 400, "invalid_code")

    def test_existing_citizen_signs_in(self):
        self.citizen.phone_number = "+919812345678"
        self.citizen.save()
        self.request()
        response = self.verify(self.last_code())
        self.assertEqual(response.status_code, 200, response.data)
        self.assertFalse(response.data["is_new_user"])
        self.assertEqual(response.data["user"]["id"], self.citizen.pk)

        me = self.client.get("/api/auth/me/", HTTP_AUTHORIZATION=f"Bearer {response.data['access']}")
        self.assertEqual(me.data["phone_number"], "+919812345678")

    def test_wrong_code_counts_attempts_until_locked(self):
        self.request()
        code = self.last_code()
        wrong = "000000" if code != "000000" else "111111"
        for left in (4, 3, 2, 1):
            response = self.verify(wrong)
            self.assertError(response, 400, "invalid_code")
            self.assertEqual(response.data["error"]["details"]["attempts_left"], left)
        self.assertIn("Too many", self.verify(wrong).data["error"]["message"])
        # Even the right code no longer works after 5 wrong attempts.
        self.assertError(self.verify(code, full_name="Anita Nair"), 400, "invalid_code")

    def test_expired_code(self):
        self.request()
        PhoneOTP.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertError(self.verify(self.last_code(), full_name="Anita Nair"), 400, "invalid_code")

    def test_disabled_citizen_cannot_sign_in(self):
        self.citizen.phone_number = "+919812345678"
        self.citizen.is_active = False
        self.citizen.save()
        self.request()
        self.assertError(self.verify(self.last_code()), 403, "account_disabled")

    def test_authority_phone_numbers_are_not_citizen_logins(self):
        # An officer with the same number gets no citizen session; a separate citizen account is created instead.
        self.officer.phone_number = "+919812345678"
        self.officer.save()
        self.request()
        response = self.verify(self.last_code(), full_name="Anita Nair")
        self.assertEqual(response.data["user"]["role"], "CITIZEN")
        self.assertNotEqual(response.data["user"]["id"], self.officer.pk)

    @override_settings(DEFAULT_COUNTRY_CODE="+44")
    def test_default_country_code_is_configurable(self):
        self.assertEqual(self.request("07700 900123").data["phone_number"], "+447700900123")


@override_settings(DEBUG=True, OTP_TEST_CODE="1234", OTP_LENGTH=4)
class OTPTestModeTests(OTPTestCase):
    """Development-only fixed code: every number signs in with 1234 and no SMS is sent."""

    def test_fixed_code_signs_in_without_sms(self):
        response = self.request()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["code_length"], 4)
        self.assertIn("Test mode", response.data["detail"])
        self.assertEqual(LocmemSMSBackend.outbox, [])

        self.assertEqual(self.verify("1234").data["status"], "name_required")
        created = self.verify("1234", full_name="Test Citizen")
        self.assertEqual(created.status_code, 201, created.data)
        self.assertEqual(created.data["user"]["phone_number"], "+919812345678")

    def test_wrong_code_still_rejected(self):
        self.request()
        self.assertError(self.verify("9999"), 400, "invalid_code")

    @override_settings(DEBUG=False)
    def test_fixed_code_is_ignored_when_debug_is_off(self):
        response = self.request()
        self.assertEqual(len(LocmemSMSBackend.outbox), 1)  # a real random code was sent instead
        self.assertNotIn("Test mode", response.data["detail"])

    @override_settings(DEBUG=False)
    def test_startup_check_refuses_fixed_code_in_production(self):
        from apps.accounts.checks import otp_test_code_check

        self.assertEqual([e.id for e in otp_test_code_check(None)], ["civiceye.E001"])
