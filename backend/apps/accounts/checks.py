from django.conf import settings
from django.core.checks import Error, Tags, register


@register(Tags.security, deploy=False)
def otp_test_code_check(app_configs, **kwargs):
    """A fixed OTP lets anyone sign in as any citizen, so it is only allowed in development."""
    code = getattr(settings, "OTP_TEST_CODE", "")
    errors = []
    if code and not settings.DEBUG:
        errors.append(
            Error(
                "OTP_TEST_CODE is set while DEBUG is False.",
                hint="Remove OTP_TEST_CODE from the environment. A fixed one-time code must never be used in production.",
                id="civiceye.E001",
            )
        )
    if code and not (code.isdigit() and 4 <= len(code) <= 8):
        errors.append(Error("OTP_TEST_CODE must be 4–8 digits.", id="civiceye.E002"))
    return errors
