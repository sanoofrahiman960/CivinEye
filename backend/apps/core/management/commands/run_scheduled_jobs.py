from django.core.management.base import BaseCommand

from apps.core.jobs import run_scheduled_jobs


class Command(BaseCommand):
    help = "Mark overdue issues, apply the verification timeout, and send fix-durability checks."

    def handle(self, *args, **options):
        results = run_scheduled_jobs()
        self.stdout.write(self.style.SUCCESS(f"Done: {results}"))
