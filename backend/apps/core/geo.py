import math

EARTH_RADIUS_M = 6_371_000


def haversine_m(lat1, lng1, lat2, lng2):
    """Great-circle distance in metres between two coordinates."""
    lat1, lng1, lat2, lng2 = map(float, (lat1, lng1, lat2, lng2))
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def bounding_box(lat, lng, radius_m):
    """Return (min_lat, max_lat, min_lng, max_lng) enclosing a circle, for a cheap index prefilter."""
    lat, lng = float(lat), float(lng)
    d_lat = math.degrees(radius_m / EARTH_RADIUS_M)
    cos_lat = max(math.cos(math.radians(lat)), 1e-6)
    d_lng = math.degrees(radius_m / (EARTH_RADIUS_M * cos_lat))
    return lat - d_lat, lat + d_lat, lng - d_lng, lng + d_lng


def approximate(value, places=3):
    """Round a coordinate (3 places is roughly 100 m) for public views."""
    return round(float(value), places)
