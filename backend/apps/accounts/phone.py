import re

from django.conf import settings
from rest_framework.exceptions import ValidationError

E164 = re.compile(r"^\+[1-9]\d{7,14}$")


def normalize_phone(raw):
    """Return the number in E.164 form (e.g. +919812345678).

    Accepts "+91 98123 45678", "0091-9812345678", or a local "09812345678" / "9812345678",
    which gets the configured DEFAULT_COUNTRY_CODE.
    """
    value = re.sub(r"[\s\-().]", "", str(raw or ""))
    if value.startswith("00"):
        value = "+" + value[2:]
    if not value.startswith("+"):
        value = settings.DEFAULT_COUNTRY_CODE + value.lstrip("0")
    if not E164.match(value):
        raise ValidationError({"phone_number": ["Enter a valid mobile number, e.g. +91 98123 45678."]})
    return value


def mask_phone(phone):
    """+919812345678 -> +91•••••45678, for messages and logs."""
    return f"{phone[:3]}{'•' * max(len(phone) - 8, 0)}{phone[-5:]}" if len(phone) > 8 else phone
