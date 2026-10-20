"""Consistent error responses.

Every error returned by the API has the shape:

    {"error": {"code": "<machine_code>", "message": "<human message>", "details": {...}}}
"""
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import exceptions, status
from rest_framework.views import exception_handler


class InvalidTransition(exceptions.APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "invalid_transition"
    default_detail = "This status change is not allowed."


class FeatureDisabled(exceptions.APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_code = "feature_disabled"
    default_detail = "This feature is not enabled."


class BusinessRuleViolation(exceptions.APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "rule_violation"
    default_detail = "This action is not allowed."

    def __init__(self, detail=None, code=None):
        super().__init__(detail=detail, code=code)
        if code:
            self.error_code = code


def _first_message(data):
    if isinstance(data, list) and data:
        return _first_message(data[0])
    if isinstance(data, dict) and data:
        key, value = next(iter(data.items()))
        message = _first_message(value)
        return message if key in ("non_field_errors", "detail") else f"{key}: {message}"
    return str(data)


def civiceye_exception_handler(exc, context):
    if isinstance(exc, DjangoValidationError):
        exc = exceptions.ValidationError(detail=exc.message_dict if hasattr(exc, "error_dict") else exc.messages)
    elif isinstance(exc, Http404):
        exc = exceptions.NotFound()
    elif isinstance(exc, DjangoPermissionDenied):
        exc = exceptions.PermissionDenied()

    response = exception_handler(exc, context)
    if response is None:
        return None

    if isinstance(exc, exceptions.ValidationError):
        code = "validation_error"
        details = response.data
        message = _first_message(response.data)
    else:
        code = getattr(exc, "error_code", None)
        if code is None:
            codes = exc.get_codes()
            code = codes if isinstance(codes, str) else getattr(exc, "default_code", "error")
        detail = response.data.get("detail") if isinstance(response.data, dict) else response.data
        message = str(detail) if detail is not None else str(exc)
        details = {}

    response.data = {"error": {"code": code, "message": message, "details": details}}
    return response
