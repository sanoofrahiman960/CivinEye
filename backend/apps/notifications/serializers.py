from rest_framework import serializers

from .models import DeviceToken, Notification


class NotificationSerializer(serializers.ModelSerializer):
    complaint_id = serializers.CharField(source="issue.complaint_id", read_only=True, default=None)

    class Meta:
        model = Notification
        fields = ("id", "issue", "complaint_id", "title", "message", "notification_type", "is_read", "created_at")
        read_only_fields = fields


class DeviceTokenSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=255)
    platform = serializers.ChoiceField(choices=("ios", "android", "web"), required=False, allow_blank=True)


class DeviceTokenRemoveSerializer(serializers.Serializer):
    token = serializers.CharField(max_length=255)
