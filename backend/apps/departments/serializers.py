from rest_framework import serializers

from .models import Department, ServiceArea


class ServiceAreaSerializer(serializers.ModelSerializer):
    level_label = serializers.CharField(source="get_level_display", read_only=True)

    class Meta:
        model = ServiceArea
        fields = ("id", "name", "code", "level", "level_label", "parent")


class DepartmentSerializer(serializers.ModelSerializer):
    service_areas = ServiceAreaSerializer(many=True, read_only=True)

    class Meta:
        model = Department
        fields = ("id", "name", "code", "description", "contact_email", "service_areas")


class DepartmentMiniSerializer(serializers.ModelSerializer):
    class Meta:
        model = Department
        fields = ("id", "name")
