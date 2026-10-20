"""Phone + one-time-code sign-in for citizens.

The same flow signs citizens in and signs them up:
1. request_code(phone)  -> a 6-digit code is sent by SMS (only its hash is stored).
2. verify_code(phone, code, full_name) -> existing citizen: signed in.
   New number: the first verify returns NAME_REQUIRED without using up the code; the app asks for a
   name and verifies again with it, which creates the account.
"""
import logging
import secrets
from dataclasses import dataclass
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.utils import timezone

from apps.audit.models import log_action

from .models import PhoneOTP, Role, User
from .phone import mask_phone
from .sms import SMSDeliveryError, send_sms

logger = logging.getLogger("civiceye.sms")


class OTPError(Exception):
    def __init__(self, code, message, status=400, details=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
        self.details = details or {}


@dataclass
class VerifyResult:
    user: User | None
    created: bool = False
    name_required: bool = False


def request_code(phone):
    now = timezone.now()
    latest = PhoneOTP.objects.filter(phone_number=phone).first()
    cooldown = settings.OTP_RESEND_COOLDOWN_SECONDS
    if latest and (now - latest.created_at).total_seconds() < cooldown:
        wait = int(cooldown - (now - latest.created_at).total_seconds()) + 1
        raise OTPError(
            "otp_cooldown",
            f"Please wait {wait} seconds before requesting a new code.",
            429,
            {"retry_after": wait, "code_length": settings.OTP_LENGTH},
        )
    sent_last_hour = PhoneOTP.objects.filter(phone_number=phone, created_at__gte=now - timedelta(hours=1)).count()
    if sent_last_hour >= settings.OTP_MAX_PER_HOUR:
        raise OTPError("otp_limit", "Too many codes requested for this number. Try again in an hour.", 429)

    # Only the newest code is valid.
    PhoneOTP.objects.filter(phone_number=phone, consumed_at__isnull=True).update(consumed_at=now)
    test_code = settings.OTP_TEST_CODE if settings.DEBUG else ""
    code = test_code or f"{secrets.randbelow(10 ** settings.OTP_LENGTH):0{settings.OTP_LENGTH}d}"
    otp = PhoneOTP.objects.create(
        phone_number=phone,
        code_hash=make_password(code),
        expires_at=now + timedelta(seconds=settings.OTP_TTL_SECONDS),
    )
    minutes = max(settings.OTP_TTL_SECONDS // 60, 1)
    if test_code:
        logger.warning("OTP test mode: %s can sign in with the fixed test code (no SMS sent).", mask_phone(phone))
        return otp
    try:
        send_sms(phone, f"{code} is your CivicEye sign-in code. It expires in {minutes} minutes. Do not share it with anyone.")
    except SMSDeliveryError:
        otp.delete()
        raise OTPError("sms_failed", "We couldn't send the SMS right now. Please try again shortly.", 503)
    return otp


def verify_code(phone, code, full_name=""):
    now = timezone.now()
    otp = PhoneOTP.objects.filter(phone_number=phone, consumed_at__isnull=True).first()
    if otp is None or otp.expires_at <= now or otp.attempts >= settings.OTP_MAX_ATTEMPTS:
        raise OTPError("invalid_code", "This code has expired. Request a new one.")
    if not check_password(code, otp.code_hash):
        otp.attempts += 1
        otp.save(update_fields=["attempts"])
        left = settings.OTP_MAX_ATTEMPTS - otp.attempts
        message = f"Incorrect code. {left} attempt{'s' if left != 1 else ''} left." if left else "Too many wrong attempts. Request a new code."
        raise OTPError("invalid_code", message, details={"attempts_left": left})

    user = User.objects.filter(role=Role.CITIZEN, phone_number=phone).first()
    if user is not None and not user.is_active:
        raise OTPError("account_disabled", "This account has been disabled. Contact your municipality.", 403)

    created = False
    if user is None:
        full_name = (full_name or "").strip()
        if len(full_name) < 2:
            # Valid code for a new number: keep the code usable and ask for a name first.
            return VerifyResult(user=None, name_required=True)
        user = User.objects.create_user(email=None, password=None, full_name=full_name, phone_number=phone, role=Role.CITIZEN)
        created = True
        log_action(user, "user.registered", user, {"method": "phone_otp"})

    otp.consumed_at = now
    otp.save(update_fields=["consumed_at"])
    log_action(user, "user.otp_login", user, {"phone": mask_phone(phone)})
    return VerifyResult(user=user, created=created)
