from django.shortcuts import get_object_or_404
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema
from rest_framework import generics, status
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import DeviceToken, Notification
from .serializers import DeviceTokenRemoveSerializer, DeviceTokenSerializer, NotificationSerializer


class NotificationListView(generics.ListAPIView):
    serializer_class = NotificationSerializer
    filter_backends = []

    def get_queryset(self):
        qs = Notification.objects.filter(recipient=self.request.user).select_related("issue")
        unread = self.request.query_params.get("unread")
        if unread in ("1", "true"):
            qs = qs.filter(is_read=False)
        return qs


class NotificationReadView(APIView):
    @extend_schema(request=None, responses=NotificationSerializer)
    def patch(self, request, pk):
        notification = get_object_or_404(Notification, pk=pk, recipient=request.user)
        if not notification.is_read:
            notification.is_read = True
            notification.save(update_fields=["is_read"])
        return Response(NotificationSerializer(notification).data)


class NotificationReadAllView(APIView):
    @extend_schema(request=None, responses=OpenApiTypes.OBJECT)
    def post(self, request):
        updated = Notification.objects.filter(recipient=request.user, is_read=False).update(is_read=True)
        return Response({"updated": updated})


class UnreadCountView(APIView):
    @extend_schema(responses=OpenApiTypes.OBJECT)
    def get(self, request):
        return Response({"unread": Notification.objects.filter(recipient=request.user, is_read=False).count()})


class DeviceTokenView(generics.GenericAPIView):
    serializer_class = DeviceTokenSerializer

    def post(self, request):
        serializer = self.get_serializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        DeviceToken.objects.update_or_create(
            token=serializer.validated_data["token"],
            defaults={
                "user": request.user,
                "platform": serializer.validated_data.get("platform", ""),
                "is_active": True,
            },
        )
        return Response(status=status.HTTP_204_NO_CONTENT)

    def delete(self, request):
        serializer = DeviceTokenRemoveSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        DeviceToken.objects.filter(user=request.user, token=serializer.validated_data["token"]).update(is_active=False)
        return Response(status=status.HTTP_204_NO_CONTENT)
