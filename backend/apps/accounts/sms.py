"""SMS delivery for one-time codes.

Choose a backend with the SMS_BACKEND setting:
- apps.accounts.sms.ConsoleSMSBackend  (default) prints messages to the server log, for development.
- apps.accounts.sms.TwilioSMSBackend   sends real SMS via Twilio (TWILIO_* settings).
- apps.accounts.sms.LocmemSMSBackend   keeps messages in memory, for tests.

To use another provider (MSG91, Fast2SMS, AWS SNS…), subclass BaseSMSBackend and implement `send`.
"""
import logging

import requests
from django.conf import settings
from django.utils.module_loading import import_string

logger = logging.getLogger("civiceye.sms")


class SMSDeliveryError(Exception):
    pass


class BaseSMSBackend:
    def send(self, to, message):
        raise NotImplementedError


class ConsoleSMSBackend(BaseSMSBackend):
    def send(self, to, message):
        # Development only: the code is visible in the server console so you can sign in without an SMS provider.
        logger.warning("SMS to %s: %s", to, message)


class LocmemSMSBackend(BaseSMSBackend):
    outbox = []

    def send(self, to, message):
        LocmemSMSBackend.outbox.append({"to": to, "message": message})


class TwilioSMSBackend(BaseSMSBackend):
    def send(self, to, message):
        sid, token, sender = settings.TWILIO_ACCOUNT_SID, settings.TWILIO_AUTH_TOKEN, settings.TWILIO_FROM_NUMBER
        if not (sid and token and sender):
            raise SMSDeliveryError("Twilio is not configured.")
        try:
            response = requests.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json",
                data={"To": to, "From": sender, "Body": message},
                auth=(sid, token),
                timeout=10,
            )
            response.raise_for_status()
        except requests.RequestException as exc:
            raise SMSDeliveryError(str(exc.__class__.__name__)) from exc


def send_sms(to, message):
    backend = import_string(settings.SMS_BACKEND)()
    backend.send(to, message)
