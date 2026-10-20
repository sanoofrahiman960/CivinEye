"""`manage.py runserver` for CivicEye: Daphne (ASGI) on port 8001 by default.

Port 8000 is often taken by other local projects, and the mobile app and web dashboard expect 8001.
Pass an explicit address to override, e.g. `runserver 0.0.0.0:8001` so phones on your Wi-Fi can connect.
"""
from daphne.management.commands.runserver import Command as DaphneRunserverCommand


class Command(DaphneRunserverCommand):
    default_port = "8001"
