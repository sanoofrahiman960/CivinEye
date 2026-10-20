from django.urls import path

from . import views

urlpatterns = [
    path("", views.IssueCreateView.as_view(), name="issue-create"),
    path("my/", views.MyIssuesView.as_view(), name="issue-my"),
    path("my/summary/", views.MyIssueSummaryView.as_view(), name="issue-my-summary"),
    path("nearby/", views.NearbyIssuesView.as_view(), name="issue-nearby"),
    path("map/", views.MapIssuesView.as_view(), name="issue-map"),
    path("<int:pk>/", views.IssueDetailView.as_view(), name="issue-detail"),
    path("<int:pk>/history/", views.IssueHistoryView.as_view(), name="issue-history"),
    path("<int:pk>/comments/", views.IssueCommentsView.as_view(), name="issue-comments"),
    path("<int:pk>/additional-evidence/", views.AdditionalEvidenceView.as_view(), name="issue-evidence"),
    path("<int:pk>/reopen/", views.ReopenView.as_view(), name="issue-reopen"),
    path("<int:pk>/confirm-resolution/", views.ConfirmResolutionView.as_view(), name="issue-confirm"),
    path("<int:pk>/support/", views.SupportView.as_view(), name="issue-support"),
    path("<int:pk>/durability-response/", views.DurabilityResponseView.as_view(), name="issue-durability-response"),
]
