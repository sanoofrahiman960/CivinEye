from django.urls import path

from . import views

urlpatterns = [
    path("", views.NotificationListView.as_view(), name="notification-list"),
    path("unread-count/", views.UnreadCountView.as_view(), name="notification-unread-count"),
    path("read-all/", views.NotificationReadAllView.as_view(), name="notification-read-all"),
    path("devices/", views.DeviceTokenView.as_view(), name="notification-devices"),
    path("<int:pk>/read/", views.NotificationReadView.as_view(), name="notification-read"),
]
