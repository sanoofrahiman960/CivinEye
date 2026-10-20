from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.core.views import ConfigurationView
from apps.departments.views import DepartmentListView, ServiceAreaListView
from apps.issues.views import CategoryListView, DurabilityCheckListView, EmergencyContactListView

admin.site.site_header = "CivicEye administration"
admin.site.site_title = "CivicEye admin"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("apps.accounts.urls")),
    path("api/issues/", include("apps.issues.urls")),
    path("api/authority/", include("apps.issues.authority_urls")),
    path("api/notifications/", include("apps.notifications.urls")),
    path("api/departments/", DepartmentListView.as_view(), name="department-list"),
    path("api/service-areas/", ServiceAreaListView.as_view(), name="service-area-list"),
    path("api/issue-categories/", CategoryListView.as_view(), name="category-list"),
    path("api/emergency-contacts/", EmergencyContactListView.as_view(), name="emergency-contact-list"),
    path("api/durability-checks/", DurabilityCheckListView.as_view(), name="durability-check-list"),
    path("api/configuration/", ConfigurationView.as_view(), name="configuration"),
    path("api/schema/", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs/", SpectacularSwaggerView.as_view(url_name="schema"), name="swagger-ui"),
]

if settings.DEBUG:
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
