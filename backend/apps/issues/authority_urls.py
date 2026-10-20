from django.urls import path

from apps.accounts.team import AreaListView, TeamDetailView, TeamListCreateView, TeamResetPasswordView
from apps.accounts.views import OfficerListView
from apps.analytics.views import DashboardView, ReportsView

from . import authority_views as views

urlpatterns = [
    path("dashboard/", DashboardView.as_view(), name="authority-dashboard"),
    path("reports/", ReportsView.as_view(), name="authority-reports"),
    path("officers/", OfficerListView.as_view(), name="authority-officers"),
    path("areas/", AreaListView.as_view(), name="authority-areas"),
    path("team/", TeamListCreateView.as_view(), name="authority-team"),
    path("team/<int:pk>/", TeamDetailView.as_view(), name="authority-team-member"),
    path("team/<int:pk>/reset-password/", TeamResetPasswordView.as_view(), name="authority-team-reset-password"),
    path("issues/", views.AuthorityIssueListView.as_view(), name="authority-issue-list"),
    path("issues/<int:pk>/", views.AuthorityIssueDetailView.as_view(), name="authority-issue-detail"),
    path("issues/<int:pk>/priority/", views.PriorityView.as_view(), name="authority-issue-priority"),
    path("issues/<int:pk>/acknowledge/", views.AcknowledgeView.as_view(), name="authority-issue-acknowledge"),
    path("issues/<int:pk>/assign/", views.AssignView.as_view(), name="authority-issue-assign"),
    path("issues/<int:pk>/start-work/", views.StartWorkView.as_view(), name="authority-issue-start-work"),
    path("issues/<int:pk>/resolve/", views.ResolveView.as_view(), name="authority-issue-resolve"),
    path("issues/<int:pk>/reopen/", views.AuthorityReopenView.as_view(), name="authority-issue-reopen"),
    path("issues/<int:pk>/close/", views.AdminCloseView.as_view(), name="authority-issue-close"),
    path("issues/<int:pk>/comments/", views.AuthorityCommentView.as_view(), name="authority-issue-comments"),
    path("images/<int:pk>/override-proof-check/", views.ProofCheckOverrideView.as_view(), name="authority-image-override"),
]
