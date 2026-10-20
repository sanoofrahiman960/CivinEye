"""Periodic jobs. Run by Celery Beat (`run_scheduled_jobs_task`) or by cron via
`python manage.py run_scheduled_jobs`. Every job is idempotent, so running it twice is harmless."""
import logging

from django.utils import timezone

logger = logging.getLogger(__name__)


def run_scheduled_jobs(now=None):
    from apps.community.services import expire_durability_checks, send_due_durability_checks
    from apps.issues.services import auto_close_expired_verifications, mark_overdue

    now = now or timezone.now()
    results = {
        "overdue": mark_overdue(now),
        "auto_closed": auto_close_expired_verifications(now),
        "durability_sent": send_due_durability_checks(now),
        "durability_expired": expire_durability_checks(now),
    }
    logger.info("Scheduled jobs finished: %s", results)
    return results
