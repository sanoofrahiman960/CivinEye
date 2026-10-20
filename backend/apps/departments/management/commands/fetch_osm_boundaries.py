"""Download official administrative boundaries from OpenStreetMap as GeoJSON files for `import_areas`.

    python manage.py fetch_osm_boundaries --region IN-KL --out data/kerala
    python manage.py fetch_osm_boundaries --region IN-KL --out data/kerala --wards   # also ~12k wards

Writes state.geojson, districts.geojson, taluks.geojson, grama_panchayats.geojson,
municipalities.geojson and corporations.geojson (and wards.geojson with --wards). Each feature has
`name` and `osm_id` properties and a Polygon/MultiPolygon geometry, simplified to about 10 m.

Boundary data © OpenStreetMap contributors, available under the Open Database Licence (ODbL).
Check it against your government's official boundaries before relying on it.
"""
import json
import time
from pathlib import Path

import requests
from django.core.management.base import BaseCommand, CommandError

OVERPASS_URLS = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)

# (file name, Overpass filter). OSM India: state = admin_level 4, district = 5, taluk = 6;
# local bodies are boundary=local_authority at level 8 (local_authority:IN tells the kind), wards at level 10.
LAYERS = [
    ("state", '["boundary"="administrative"]["admin_level"="4"]'),
    ("districts", '["boundary"="administrative"]["admin_level"="5"]'),
    ("taluks", '["boundary"="administrative"]["admin_level"="6"]'),
    ("local_bodies", '["boundary"="local_authority"]["admin_level"="8"]'),
]
WARDS = ("wards", '["boundary"="local_authority"]["admin_level"="10"]')

LOCAL_BODY_FILES = {
    "gram_panchayat": "grama_panchayats",
    "grama_panchayath": "grama_panchayats",
    "municipality": "municipalities",
    "municipal_corporation": "corporations",
}

SIMPLIFY_DEGREES = 0.0001  # ≈ 11 m


def _simplify(points, epsilon=SIMPLIFY_DEGREES):
    """Ramer–Douglas–Peucker on [lng, lat] points (keeps rings closed)."""
    if len(points) < 5:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        start, end = stack.pop()
        (x1, y1), (x2, y2) = points[start], points[end]
        dx, dy = x2 - x1, y2 - y1
        norm = (dx * dx + dy * dy) ** 0.5
        best, index = 0.0, None
        for i in range(start + 1, end):
            x, y = points[i]
            dist = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm if norm else ((x - x1) ** 2 + (y - y1) ** 2) ** 0.5
            if dist > best:
                best, index = dist, i
        if index is not None and best > epsilon:
            keep[index] = True
            stack.extend([(start, index), (index, end)])
    result = [p for p, k in zip(points, keep) if k]
    return result if len(result) >= 4 else points


def _stitch(ways):
    """Join way segments ([[lng, lat], ...]) into closed rings."""
    segments = [list(w) for w in ways if len(w) >= 2]
    rings = []
    while segments:
        ring = segments.pop(0)
        progress = True
        while ring[0] != ring[-1] and progress:
            progress = False
            for i, seg in enumerate(segments):
                if seg[0] == ring[-1]:
                    ring.extend(seg[1:])
                elif seg[-1] == ring[-1]:
                    ring.extend(reversed(seg[:-1]))
                elif seg[-1] == ring[0]:
                    ring[:0] = seg[:-1]
                elif seg[0] == ring[0]:
                    ring[:0] = list(reversed(seg[1:]))
                else:
                    continue
                segments.pop(i)
                progress = True
                break
        if ring[0] == ring[-1] and len(ring) >= 4:
            rings.append(ring)
    return rings


def _point_in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _relation_geometry(relation):
    outer, inner = [], []
    for member in relation.get("members", []):
        if member.get("type") != "way" or not member.get("geometry"):
            continue
        coords = [[round(p["lon"], 6), round(p["lat"], 6)] for p in member["geometry"]]
        (inner if member.get("role") == "inner" else outer).append(coords)
    outers = [_simplify(r) for r in _stitch(outer)]
    inners = [_simplify(r) for r in _stitch(inner)]
    if not outers:
        return None
    polygons = [[ring] for ring in outers]
    for hole in inners:
        for polygon in polygons:
            if _point_in_ring(hole[0][0], hole[0][1], polygon[0]):
                polygon.append(hole)
                break
    if len(polygons) == 1:
        return {"type": "Polygon", "coordinates": polygons[0]}
    return {"type": "MultiPolygon", "coordinates": polygons}


class Command(BaseCommand):
    help = "Download administrative boundaries for a state from OpenStreetMap (Overpass API) as GeoJSON files."

    def add_arguments(self, parser):
        parser.add_argument("--region", default="IN-KL", help="ISO 3166-2 code of the state, e.g. IN-KL for Kerala.")
        parser.add_argument("--out", default="data/kerala", help="Output folder.")
        parser.add_argument("--wards", action="store_true", help="Also download wards (large).")
        parser.add_argument("--only", nargs="+", choices=[n for n, _ in LAYERS] + ["wards"], help="Download only these layers.")

    def _query(self, region, tag_filter):
        query = f'[out:json][timeout:600];area["ISO3166-2"="{region}"]->.a;rel(area.a){tag_filter};out geom qt;'
        last_error = None
        for url in OVERPASS_URLS:
            for attempt in range(3):
                try:
                    response = requests.post(url, data={"data": query}, timeout=700, headers={"User-Agent": "CivicEye-setup/1.0"})
                    if response.status_code == 200:
                        return response.json()["elements"]
                    last_error = f"HTTP {response.status_code} from {url}"
                except (requests.RequestException, ValueError) as exc:
                    last_error = f"{type(exc).__name__} from {url}"
                time.sleep(10 * (attempt + 1))
        raise CommandError(f"Overpass API unavailable ({last_error}). Try again later.")

    def handle(self, *args, **options):
        out = Path(options["out"])
        out.mkdir(parents=True, exist_ok=True)
        layers = LAYERS + ([WARDS] if options["wards"] or (options["only"] and "wards" in options["only"]) else [])
        if options["only"]:
            layers = [layer for layer in layers if layer[0] in options["only"]]
        for name, tag_filter in layers:
            self.stdout.write(f"Downloading {name}…")
            relations = self._query(options["region"], tag_filter)
            files = {}
            skipped = 0
            for relation in relations:
                tags = relation.get("tags", {})
                geometry = _relation_geometry(relation)
                label = tags.get("name:en") or tags.get("name")
                if geometry is None or not label:
                    skipped += 1
                    continue
                target = name
                if name == "local_bodies":
                    kind = tags.get("local_authority:IN") or tags.get("designation", "")
                    target = LOCAL_BODY_FILES.get(kind)
                    if target is None:
                        skipped += 1
                        continue
                feature = {
                    "type": "Feature",
                    "properties": {
                        "name": label.strip(),
                        "osm_id": relation["id"],
                        "kind": tags.get("local_authority:IN") or tags.get("designation", ""),
                    },
                    "geometry": geometry,
                }
                files.setdefault(target, []).append(feature)
            for target, features in files.items():
                path = out / f"{target}.geojson"
                path.write_text(json.dumps({"type": "FeatureCollection", "features": features}), encoding="utf-8")
                self.stdout.write(f"  {path}: {len(features)} areas")
            if skipped:
                self.stdout.write(f"  skipped {skipped} (no name, unknown kind or incomplete boundary)")
        self.stdout.write(self.style.SUCCESS("Done. Data © OpenStreetMap contributors (ODbL)."))
