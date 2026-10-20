from rest_framework import generics

from .models import Department, ServiceArea
from .serializers import DepartmentSerializer, ServiceAreaSerializer


class DepartmentListView(generics.ListAPIView):
    queryset = Department.objects.filter(is_active=True).prefetch_related("service_areas")
    serializer_class = DepartmentSerializer
    pagination_class = None
    filter_backends = []


class ServiceAreaListView(generics.ListAPIView):
    queryset = ServiceArea.objects.filter(is_active=True)
    serializer_class = ServiceAreaSerializer
    pagination_class = None
    filter_backends = []
