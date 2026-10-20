import logging

import requests
from celery import shared_task
from django.conf import settings

from .models import DeviceToken, Notification

logger = logging.getLogger(__name__)


@shared_task(ignore_result=True)
def send_push_notification(notification_id, high_priority=False):
    """Send a notification to the recipient's registered devices through the Expo push service."""
    if not settings.EXPO_PUSH_ENABLED:
        return
    notification = Notification.objects.filter(pk=notification_id).select_related("recipient").first()
    if notification is None:
        return
    tokens = list(DeviceToken.objects.filter(user=notification.recipient, is_active=True))
    if not tokens:
        return

    messages = [
        {
            "to": t.token,
            "title": notification.title,
            "body": notification.message,
            "sound": "default",
            "priority": "high" if high_priority else "default",
            "channelId": "urgent" if high_priority else "default",
            "data": {"notification_id": notification.pk, "issue_id": notification.issue_id},
        }
        for t in tokens
    ]
    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    if settings.EXPO_ACCESS_TOKEN:
        headers["Authorization"] = f"Bearer {settings.EXPO_ACCESS_TOKEN}"
    try:
        response = requests.post(settings.EXPO_PUSH_URL, json=messages, headers=headers, timeout=10)
        response.raise_for_status()
        tickets = response.json().get("data", [])
    except (requests.RequestException, ValueError) as exc:
        logger.warning("Expo push failed for notification %s: %s", notification_id, exc.__class__.__name__)
        return

    for token, ticket in zip(tokens, tickets):
        if ticket.get("status") == "error" and ticket.get("details", {}).get("error") == "DeviceNotRegistered":
            token.is_active = False
            token.save(update_fields=["is_active"])
