"""Demo accounts and sample issues for local development and testing ONLY.

    python manage.py seed_demo                 # reference data + demo users
    python manage.py seed_demo --with-samples  # also create sample issues in different states

Never run this on a real deployment: it creates accounts with a published password.
For real use, run `setup_reference_data` and `createsuperuser` instead.
"""
import io
import random
from decimal import Decimal

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand
from django.db import transaction
from PIL import Image, ImageDraw

from apps.accounts.models import Role, User
from apps.departments.models import ServiceArea
from apps.issues.models import Issue

from .setup_reference_data import create_reference_data

DEMO_PASSWORD = "CivicEye@2026"

USERS = [
    ("admin", "Asha Admin", Role.ADMIN, None, True),
    ("supervisor.sanitation", "Suresh Supervisor", Role.SUPERVISOR, "sanitation", False),
    ("officer.sanitation", "Sana Officer", Role.OFFICER, "sanitation", False),
    ("officer.municipal", "Manoj Officer", Role.OFFICER, "municipal", False),
    ("officer.pwd", "Priya Officer", Role.OFFICER, "pwd", False),
    ("officer.water", "Wasim Officer", Role.OFFICER, "water", False),
    ("officer.electrical", "Elena Officer", Role.OFFICER, "electrical", False),
    # Citizens have no email or password: they sign in with this mobile number + OTP.
    ("+919800000101", "Chitra Citizen", Role.CITIZEN, None, False),
    ("+919800000102", "Rahul Resident", Role.CITIZEN, None, False),
]


def demo_photo(seed):
    rng = random.Random(seed)
    img = Image.new("RGB", (800, 600), tuple(rng.randint(40, 220) for _ in range(3)))
    draw = ImageDraw.Draw(img)
    for _ in range(25):
        x, y = rng.randint(0, 760), rng.randint(0, 560)
        draw.rectangle([x, y, x + rng.randint(20, 200), y + rng.randint(20, 150)], fill=tuple(rng.randint(0, 255) for _ in range(3)))
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG")
    return SimpleUploadedFile(f"demo-{seed}.jpg", buffer.getvalue(), content_type="image/jpeg")


class Command(BaseCommand):
    help = "Create demo departments, categories, feature flags and accounts (development only)."

    def add_arguments(self, parser):
        parser.add_argument("--with-samples", action="store_true", help="Also create sample issues.")

    @transaction.atomic
    def handle(self, *args, **options):
        departments, categories = create_reference_data()

        users = {}
        for index, (login, full_name, role, dept_code, is_superuser) in enumerate(USERS, start=1):
            if role == Role.CITIZEN:
                user = User.objects.filter(role=Role.CITIZEN, phone_number=login).first()
                if user is None:
                    user = User.objects.create_user(None, None, full_name=full_name, role=role, phone_number=login)
            else:
                user = User.objects.filter(username=login).first()
                if user is None:
                    extra = {"full_name": full_name, "role": role, "phone_number": f"+9198000000{index:02d}"}
                    if dept_code:
                        extra["department"] = departments[dept_code]
                    create = User.objects.create_superuser if is_superuser else User.objects.create_user
                    user = create(login, DEMO_PASSWORD, **extra)
                    if role in (Role.OFFICER, Role.SUPERVISOR):
                        # Jurisdiction: these demo officers handle issues located in Kochi only.
                        user.service_areas.set(ServiceArea.objects.filter(code="kochi"))
            users[login] = user

        self.stdout.write(self.style.SUCCESS("Reference data and demo accounts are ready."))
        self.stdout.write(f"Authority demo accounts use the password: {DEMO_PASSWORD}")
        self.stdout.write("Citizen demo accounts sign in with their number + the OTP printed in the server console.")
        for login, _, role, _, _ in USERS:
            self.stdout.write(f"  {role:<11} {login}")

        if options["with_samples"]:
            self._create_samples(users, categories)

    def _create_samples(self, users, categories):
        from apps.issues import services

        if Issue.objects.exists():
            self.stdout.write("Issues already exist; skipping sample issues.")
            return
        citizen = users["+919800000101"]
        neighbour = users["+919800000102"]
        officer = users["officer.sanitation"]
        municipal = users["officer.municipal"]
        pwd = users["officer.pwd"]

        samples = [
            (citizen, "garbage-on-road", "Garbage piled near the bus stop", 9.9816, 76.2999, "MG Road bus stop, Kochi", "new"),
            (citizen, "overflowing-bin", "Overflowing bin outside the market", 9.9770, 76.2840, "Broadway market, Kochi", "acknowledged"),
            (neighbour, "waterlogging", "Road flooded after rain", 9.9650, 76.2950, "Kadavanthra junction, Kochi", "in_progress"),
            (citizen, "pothole", "Deep pothole on the main road", 9.9900, 76.3050, "Kaloor stadium road, Kochi", "resolved"),
            (neighbour, "illegal-dumping", "Construction waste dumped on footpath", 9.9600, 76.2900, "Panampilly Nagar, Kochi", "closed"),
            (citizen, "streetlight", "Streetlight not working for a week", 9.9850, 76.2800, "Marine Drive walkway, Kochi", "new"),
        ]
        for index, (reporter, slug, title, lat, lng, address, target) in enumerate(samples):
            issue, _ = services.create_issue(
                reporter,
                {
                    "title": title,
                    "description": f"{title}. Reported as demo data for CivicEye.",
                    "category": categories[slug],
                    "latitude": Decimal(str(lat)),
                    "longitude": Decimal(str(lng)),
                    "address": address,
                },
                [demo_photo(index)],
            )
            actor = {"sanitation": officer, "municipal": municipal, "pwd": pwd}.get(issue.department.code, users["admin"])
            if target == "new":
                continue
            services.acknowledge(issue, actor)
            if target == "acknowledged":
                continue
            services.start_work(issue, actor)
            if target == "in_progress":
                continue
            capture = {
                "capture_source": "CAMERA",
                "capture_latitude": issue.latitude,
                "capture_longitude": issue.longitude,
                "capture_accuracy_m": 8,
            }
            services.resolve(issue, actor, "Work completed by the field team.", [demo_photo(100 + index)], capture)
            if target == "closed":
                issue.refresh_from_db()
                services.confirm_resolution(issue, issue.reporter, 5, "Fixed quickly, thank you.")
        self.stdout.write(self.style.SUCCESS(f"Created {len(samples)} sample issues."))
