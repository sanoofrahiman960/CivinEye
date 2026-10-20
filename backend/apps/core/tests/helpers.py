import io
import random
import shutil
import tempfile
from decimal import Decimal

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from PIL import Image, ImageDraw
from rest_framework.test import APITestCase

from apps.accounts.models import Role, User
from apps.core.models import FeatureFlag
from apps.departments.models import Department, ServiceArea
from apps.issues import services
from apps.issues.models import IssueCategory

PASSWORD = "Str0ng-Test-Pass!"
ISSUE_LAT = Decimal("9.981600")
ISSUE_LNG = Decimal("76.299900")


def make_image(seed=0, fmt="JPEG", size=(640, 480), exif=None):
    rng = random.Random(seed)
    img = Image.new("RGB", size, tuple(rng.randint(0, 255) for _ in range(3)))
    draw = ImageDraw.Draw(img)
    for _ in range(30):
        x, y = rng.randint(0, size[0] - 10), rng.randint(0, size[1] - 10)
        draw.rectangle([x, y, x + rng.randint(5, 200), y + rng.randint(5, 150)], fill=tuple(rng.randint(0, 255) for _ in range(3)))
    buffer = io.BytesIO()
    kwargs = {"exif": exif} if exif is not None else {}
    img.save(buffer, format=fmt, **kwargs)
    content_type = {"JPEG": "image/jpeg", "PNG": "image/png", "WEBP": "image/webp"}[fmt]
    return SimpleUploadedFile(f"photo-{seed}.{fmt.lower()}", buffer.getvalue(), content_type=content_type)


class CivicEyeTestCase(APITestCase):
    """Base class: isolated media folder, cleared throttle cache, and a small world of users and categories."""

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._media_dir = tempfile.mkdtemp(prefix="civiceye-test-media-")
        cls._media_override = override_settings(MEDIA_ROOT=cls._media_dir)
        cls._media_override.enable()

    @classmethod
    def tearDownClass(cls):
        cls._media_override.disable()
        shutil.rmtree(cls._media_dir, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        cache.clear()
        self.central = ServiceArea.objects.create(
            name="Central", code="central",
            min_latitude=Decimal("9.93"), max_latitude=Decimal("10.02"),
            min_longitude=Decimal("76.24"), max_longitude=Decimal("76.32"),
        )
        self.north = ServiceArea.objects.create(
            name="North", code="north",
            min_latitude=Decimal("10.10"), max_latitude=Decimal("10.20"),
            min_longitude=Decimal("76.24"), max_longitude=Decimal("76.32"),
        )
        self.sanitation = Department.objects.create(name="Sanitation", code="sanitation")
        self.pwd = Department.objects.create(name="Public Works", code="pwd")

        self.garbage = IssueCategory.objects.create(
            name="Garbage", slug="garbage", default_department=self.sanitation,
            default_priority="MEDIUM", sla_ack_hours=24, sla_resolve_hours=72,
        )
        self.pothole = IssueCategory.objects.create(
            name="Pothole", slug="pothole", default_department=self.pwd,
            default_priority="MEDIUM", sla_ack_hours=48, sla_resolve_hours=240,
        )
        self.live_wire = IssueCategory.objects.create(
            name="Live wire", slug="live-wire", default_department=self.pwd,
            default_priority="CRITICAL", sla_ack_hours=4, sla_resolve_hours=24, is_life_threatening=True,
        )

        # Citizens: phone + OTP, no username. Staff: username + password, scoped to the "Central" area.
        self.citizen = self.make_citizen("Citizen")
        self.other_citizen = self.make_citizen("Other")
        self.officer = self.make_user("officer", Role.OFFICER, self.sanitation, areas=[self.central])
        self.pwd_officer = self.make_user("pwd", Role.OFFICER, self.pwd, areas=[self.central])
        self.supervisor = self.make_user("supervisor", Role.SUPERVISOR, self.sanitation, areas=[self.central])
        self.admin = self.make_user("admin", Role.ADMIN)

    # --- helpers -----------------------------------------------------------

    _phone_counter = 0

    def next_phone(self):
        CivicEyeTestCase._phone_counter += 1
        return f"+9198{CivicEyeTestCase._phone_counter:08d}"

    def make_user(self, username, role, department=None, areas=(), **extra):
        """Authority account: username + password set up by the administrator, scoped to `areas`."""
        extra.setdefault("phone_number", self.next_phone())
        user = User.objects.create_user(
            username, PASSWORD, full_name=username.title(), role=role, department=department, **extra
        )
        if areas:
            user.service_areas.set(areas)
        return user

    def make_citizen(self, name, phone=None):
        """Citizen account as created by the phone + OTP sign-in: no username, email or password."""
        return User.objects.create_user(None, None, full_name=name, role=Role.CITIZEN, phone_number=phone or self.next_phone())

    def login(self, user):
        self.client.force_authenticate(user=user)

    def set_flag(self, key, enabled=True, **config):
        FeatureFlag.objects.update_or_create(key=key, defaults={"is_enabled": enabled, "config": config})

    def create_issue(self, reporter=None, category=None, lat=ISSUE_LAT, lng=ISSUE_LNG, seed=1, **data):
        payload = {
            "title": "Garbage near the bus stop",
            "description": "A large pile of garbage has been dumped near the bus stop.",
            "category": category or self.garbage,
            "latitude": lat,
            "longitude": lng,
            "address": "MG Road",
            **data,
        }
        issue, _ = services.create_issue(reporter or self.citizen, payload, [make_image(seed)])
        return issue

    def capture(self, lat=ISSUE_LAT, lng=ISSUE_LNG, source="CAMERA", accuracy=5):
        return {"capture_source": source, "capture_latitude": lat, "capture_longitude": lng, "capture_accuracy_m": accuracy}

    def resolve_issue(self, issue, actor=None, seed=500):
        actor = actor or self.officer
        services.acknowledge(issue, actor)
        services.start_work(issue, actor)
        resolved, _ = services.resolve(issue, actor, "Cleared the garbage.", [make_image(seed)], self.capture())
        assert resolved, "test helper expected the resolution to pass Proof-Lock"
        issue.refresh_from_db()
        return issue

    def assertError(self, response, status_code, code=None):
        self.assertEqual(response.status_code, status_code, response.content[:500])
        self.assertIn("error", response.data)
        if code:
            self.assertEqual(response.data["error"]["code"], code, response.data)
