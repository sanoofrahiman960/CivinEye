from apps.accounts.models import Role, User
from apps.core.tests.helpers import PASSWORD, CivicEyeTestCase


class AuthorityLoginTests(CivicEyeTestCase):
    """Authority staff sign in with the username + password the administrator created for them."""

    url = "/api/auth/login/"

    def test_officer_login_with_username(self):
        response = self.client.post(self.url, {"username": " OFFICER ", "password": PASSWORD}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["user"]["username"], "officer")
        self.assertTrue(response.data["user"]["is_authority"])
        self.assertEqual(response.data["user"]["department"]["name"], "Sanitation")
        self.assertEqual([a["name"] for a in response.data["user"]["service_areas"]], ["Central"])

    def test_email_is_not_a_login(self):
        self.officer.email = "officer@city.gov"
        self.officer.save()
        response = self.client.post(self.url, {"email": "officer@city.gov", "password": PASSWORD}, format="json")
        self.assertError(response, 400, "validation_error")

    def test_citizens_have_no_password_login(self):
        self.assertFalse(self.citizen.has_usable_password())
        self.assertIsNone(self.citizen.username)
        # Even a citizen given a username/password by mistake is refused here: citizens use phone + OTP.
        self.citizen.username = "sneaky"
        self.citizen.set_password(PASSWORD)
        self.citizen.save()
        response = self.client.post(self.url, {"username": "sneaky", "password": PASSWORD}, format="json")
        self.assertError(response, 403, "wrong_portal")
        self.assertIn("one-time code", response.data["error"]["message"])

    def test_wrong_password_and_inactive(self):
        self.assertError(self.client.post(self.url, {"username": "officer", "password": "nope"}, format="json"), 401)
        self.officer.is_active = False
        self.officer.save()
        self.assertError(self.client.post(self.url, {"username": "officer", "password": PASSWORD}, format="json"), 401)

    def test_no_self_service_signup_or_password_reset(self):
        for url in ("/api/auth/register/", "/api/auth/password-reset/", "/api/auth/password-reset/confirm/"):
            self.assertEqual(self.client.post(url, {"username": "x"}, format="json").status_code, 404, url)

    def test_authority_accounts_require_a_username(self):
        with self.assertRaises(ValueError):
            User.objects.create_user(None, PASSWORD, full_name="No Login", role=Role.OFFICER, department=self.sanitation)


class SessionTests(CivicEyeTestCase):
    def tokens(self):
        response = self.client.post("/api/auth/login/", {"username": "officer", "password": PASSWORD}, format="json")
        return response.data["access"], response.data["refresh"]

    def test_me_requires_authentication(self):
        self.assertError(self.client.get("/api/auth/me/"), 401, "not_authenticated")

    def test_me_and_profile_update(self):
        access, _ = self.tokens()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        self.assertEqual(self.client.get("/api/auth/me/").data["username"], "officer")
        updated = self.client.patch("/api/auth/profile/", {"full_name": "Sana K", "role": "ADMIN"}, format="json")
        self.assertEqual(updated.status_code, 200, updated.data)
        self.assertEqual(updated.data["full_name"], "Sana K")
        self.assertEqual(updated.data["role"], "OFFICER")  # role can't be self-assigned

    def test_staff_can_change_their_own_password(self):
        access, _ = self.tokens()
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        response = self.client.post("/api/auth/change-password/", {"current_password": PASSWORD, "new_password": "Brand-New-Pass-77"}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.client.credentials()
        login = self.client.post("/api/auth/login/", {"username": "officer", "password": "Brand-New-Pass-77"}, format="json")
        self.assertEqual(login.status_code, 200)

    def test_citizen_cannot_change_phone_or_password_directly(self):
        self.login(self.citizen)
        response = self.client.patch("/api/auth/profile/", {"phone_number": "+919999999999"}, format="json")
        self.assertError(response, 400, "validation_error")
        self.assertError(
            self.client.post("/api/auth/change-password/", {"current_password": "x", "new_password": "Brand-New-77"}),
            400,
            "not_available",
        )
        self.assertEqual(self.client.patch("/api/auth/profile/", {"full_name": "Chitra K"}, format="json").data["full_name"], "Chitra K")

    def test_refresh_and_logout_blacklists_token(self):
        _, refresh = self.tokens()
        refreshed = self.client.post("/api/auth/token/refresh/", {"refresh": refresh}, format="json")
        self.assertEqual(refreshed.status_code, 200)
        new_refresh = refreshed.data["refresh"]
        self.assertError(self.client.post("/api/auth/token/refresh/", {"refresh": refresh}, format="json"), 401)
        self.client.credentials(HTTP_AUTHORIZATION=f"Bearer {refreshed.data['access']}")
        self.assertEqual(self.client.post("/api/auth/logout/", {"refresh": new_refresh}, format="json").status_code, 205)
        self.client.credentials()
        self.assertError(self.client.post("/api/auth/token/refresh/", {"refresh": new_refresh}, format="json"), 401)


class LoginDetailsEditTests(CivicEyeTestCase):
    """Staff can edit their username (login) and email; citizens can edit their email only."""

    url = "/api/auth/profile/"

    def test_staff_change_username_then_log_in_with_it(self):
        self.login(self.officer)
        response = self.client.patch(self.url, {"username": "  Kochi.Sanitation "}, format="json")
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data["username"], "kochi.sanitation")
        self.client.force_authenticate(user=None)
        login = self.client.post("/api/auth/login/", {"username": "kochi.sanitation", "password": PASSWORD}, format="json")
        self.assertEqual(login.status_code, 200)
        self.assertError(self.client.post("/api/auth/login/", {"username": "officer", "password": PASSWORD}, format="json"), 401)
        from apps.audit.models import AuditLog

        entry = AuditLog.objects.get(action="user.login_details_changed")
        self.assertEqual(entry.metadata["username"], {"from": "officer", "to": "kochi.sanitation"})

    def test_username_rules(self):
        self.login(self.officer)
        for bad in ("", "ab", "has space", "Supervisor"):  # empty, too short, invalid, taken (case-insensitive)
            response = self.client.patch(self.url, {"username": bad}, format="json")
            self.assertError(response, 400, "validation_error")
        self.officer.refresh_from_db()
        self.assertEqual(self.officer.username, "officer")

    def test_email_add_change_and_clear(self):
        self.login(self.officer)
        self.assertEqual(self.client.patch(self.url, {"email": "Sana@City.GOV"}, format="json").data["email"], "sana@city.gov")
        self.supervisor.email = "boss@city.gov"
        self.supervisor.save()
        self.assertError(self.client.patch(self.url, {"email": "BOSS@city.gov"}, format="json"), 400, "validation_error")
        self.assertError(self.client.patch(self.url, {"email": "not-an-email"}, format="json"), 400, "validation_error")
        self.assertIsNone(self.client.patch(self.url, {"email": ""}, format="json").data["email"])

    def test_citizens_edit_email_but_have_no_username(self):
        self.login(self.citizen)
        self.assertEqual(self.client.patch(self.url, {"email": "chitra@example.com"}, format="json").data["email"], "chitra@example.com")
        self.assertError(self.client.patch(self.url, {"username": "chitra"}, format="json"), 400, "validation_error")
        self.citizen.refresh_from_db()
        self.assertIsNone(self.citizen.username)
