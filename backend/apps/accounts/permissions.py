from rest_framework.permissions import BasePermission


class IsCitizen(BasePermission):
    message = "This action is only available to citizen accounts."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_citizen)


class IsAuthority(BasePermission):
    message = "This action is only available to authority accounts."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_authority)


class IsSupervisorOrAdmin(BasePermission):
    message = "This action requires a supervisor or administrator."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_supervisor_or_admin)


class IsPlatformAdmin(BasePermission):
    message = "This action requires a system administrator."

    def has_permission(self, request, view):
        return bool(request.user and request.user.is_authenticated and request.user.is_platform_admin)
