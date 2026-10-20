from django.conf import settings
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import permissions
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.issues.models import ClosureType, CommentVisibility, Priority, Status

from .models import PlatformConfiguration, all_flags


class ConfigurationView(APIView):
    """Public configuration the mobile app needs before and after login."""

    permission_classes = [permissions.AllowAny]

    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        config = PlatformConfiguration.load()
        flags = all_flags()
        return Response(
            {
                "features": {key: {"enabled": flag.enabled, "config": flag.config} for key, flag in flags.items()},
                "policies": {
                    "verification_timeout_days": config.verification_timeout_days,
                    "auto_close_on_verification_timeout": config.auto_close_on_verification_timeout,
                    "citizen_reopen_window_days": config.citizen_reopen_window_days,
                    "max_images_per_upload": config.max_images_per_upload,
                    "max_image_size_mb": settings.MAX_IMAGE_SIZE_MB,
                },
                "choices": {
                    "priorities": [{"value": v, "label": l} for v, l in Priority.choices],
                    "statuses": [{"value": v, "label": l} for v, l in Status.choices],
                    "closure_types": [{"value": v, "label": l} for v, l in ClosureType.choices],
                    "comment_visibility": [{"value": v, "label": l} for v, l in CommentVisibility.choices],
                },
            }
        )
