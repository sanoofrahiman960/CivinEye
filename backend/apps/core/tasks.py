from celery import shared_task

from .jobs import run_scheduled_jobs


@shared_task(ignore_result=True)
def run_scheduled_jobs_task():
    run_scheduled_jobs()
