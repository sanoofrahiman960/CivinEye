from django.urls import path

from . import views

urlpatterns = [
    path("otp/request/", views.OTPRequestView.as_view(), name="auth-otp-request"),
    path("otp/verify/", views.OTPVerifyView.as_view(), name="auth-otp-verify"),
    path("login/", views.LoginView.as_view(), name="auth-login"),
    path("token/refresh/", views.RefreshView.as_view(), name="auth-token-refresh"),
    path("logout/", views.LogoutView.as_view(), name="auth-logout"),
    path("me/", views.MeView.as_view(), name="auth-me"),
    path("profile/", views.ProfileView.as_view(), name="auth-profile"),
    path("change-password/", views.ChangePasswordView.as_view(), name="auth-change-password"),
]
