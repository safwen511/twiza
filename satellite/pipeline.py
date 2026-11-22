#!/usr/bin/env python3
"""TWIZA - satellite pipeline for the oasis of Souk Lahad (Kebili, Tunisia).

Sentinel-2 L2A (10 m) -> NDVI / NDMI -> irrigated patches -> estimated water
use -> comparison with the recorded-wells registry -> H3 hexagon aggregation.

Privacy rule: the public outputs never say whether an individual patch is
"recorded" or not. Unrecorded abstraction is only published aggregated on an
H3 grid (sat_hex.geojson). The per-patch flag stays in satellite/out/.

Usage:
    python pipeline.py                  # real Sentinel-2 scene (network)
    python pipeline.py --skip-download  # reuse satellite/cache/ (offline)
    python pipeline.py --synthetic      # seeded synthetic fallback
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

# --------------------------------------------------------------------------
# Constants (all the assumptions live here)
# --------------------------------------------------------------------------
BBOX = [8.8076, 33.7433, 8.8976, 33.8133]  # lon_min, lat_min, lon_max, lat_max
TOWN_CENTER = (33.7783, 8.8526)  # lat, lon

STAC_URL = "https://earth-search.aws.element84.com/v1"
STAC_COLLECTION = "sentinel-2-l2a"
DATE_RANGES = ["2026-06-15/2026-08-31", "2025-06-15/2025-08-31"]
MAX_CLOUD = 10  # %
USER_AGENT = "twiza-satellite-pipeline/0.1"

NDVI_THRESHOLD = 0.30  # see README: chosen from the scene histogram (= Otsu, 0.299)
MIN_PATCH_HA = 0.2  # connected components smaller than this are dropped
SPLIT_SIGMA_PX = 3.0  # smoothing of NDVI before splitting big blobs (30 m)
SPLIT_MARKER_PX = 21  # one seed per local NDVI maximum in a 210 m window
PIXEL_M = 10.0
PIXEL_HA = PIXEL_M * PIXEL_M / 10_000.0

KC_DATE_PALM = 0.95  # crop coefficient, mature date palm, mid-season
IRRIGATION_EFFICIENCY = 0.6  # surface (flood/basin) irrigation
ET0_FALLBACK_MM = 9.0  # mm/day if weather.json is missing

WELL_RADIUS_M = 400.0  # a patch with no recorded well within this is "unrecorded"
H3_RES = 8
HEX_MIN_PATCHES = 0  # optional small-cell suppression (see --hex-min-patches)

SITE_WINDOW_M = (1100.0, 900.0)  # E-W, N-S
SITE_MIN_DIST_M = 600.0  # window centre at least this far from the town centre
SITE_DIST_PENALTY_PER_KM = 0.04

PNG_MAX_WIDTH = 1200
MAX_PATCH_FILE_BYTES = 600_000
SYNTH_SEED = 20260722

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CACHE_DIR = HERE / "cache"
PRIVATE_DIR = HERE / "out"
PUBLIC_DIR = ROOT / "app" / "public" / "data"
WEATHER_JSON = ROOT / "data" / "weather.json"
REGISTRY_CSV = ROOT / "data" / "wells_registry.csv"
PLOTS_GEOJSON = ROOT / "data" / "plots.geojson"

SOURCE_REAL = "sentinel-2-l2a via Element84 Earth Search"
SOURCE_SYNTH = "synthetic-fallback"


def log(msg: str) -> None:
    print(f"[satellite] {msg}", flush=True)


@dataclass
class Scene:
    ndvi: np.ndarray  # float32, UTM grid, NaN where invalid
    ndmi: np.ndarray
    transform: object  # affine.Affine
    crs: str
    source: str
    scene_id: str | None = None
    scene_date: str | None = None
    cloud_cover: float | None = None
    extra: dict = field(default_factory=dict)


# --------------------------------------------------------------------------
# Grid helpers
# --------------------------------------------------------------------------
def utm_grid_for_bbox(crs: str, snap: float = 20.0):
    """Bounds of BBOX in `crs`, snapped outward to a multiple of `snap` metres."""
    from rasterio.warp import transform_bounds

    left, bottom, right, top = transform_bounds("EPSG:4326", crs, *BBOX, densify_pts=21)
    left = math.floor(left / snap) * snap
    bottom = math.floor(bottom / snap) * snap
    right = math.ceil(right / snap) * snap
    top = math.ceil(top / snap) * snap
    return left, bottom, right, top


def pixel_lonlat(transform, crs: str, shape):
    """Longitude / latitude of every pixel centre."""
    from pyproj import Transformer

    h, w = shape
    xs = transform.c + (np.arange(w) + 0.5) * transform.a
    ys = transform.f + (np.arange(h) + 0.5) * transform.e
    xx, yy = np.meshgrid(xs, ys)
    tr = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    lon, lat = tr.transform(xx, yy)
    return lon, lat


# --------------------------------------------------------------------------
# 1. Real scene: STAC search + windowed COG reads (+ cache)
# --------------------------------------------------------------------------
def search_scenes():
    from pystac_client import Client
    from shapely.geometry import box, shape

    client = Client.open(STAC_URL, headers={"User-Agent": USER_AGENT}, timeout=30)
    aoi = box(*BBOX)
    for dates in DATE_RANGES:
        search = client.search(
            collections=[STAC_COLLECTION],
            bbox=BBOX,
            datetime=dates,
            query={"eo:cloud_cover": {"lt": MAX_CLOUD}},
            max_items=200,
        )
        items = list(search.items())
        log(f"STAC {dates}: {len(items)} scenes with cloud < {MAX_CLOUD}%")
        # keep scenes whose footprint fully covers the bbox (no swath edge)
        full = [it for it in items if it.geometry and shape(it.geometry).contains(aoi)]
        cands = full or items
        cands.sort(key=lambda it: (it.properties.get("eo:cloud_cover", 100.0), it.id))
        if cands:
            return cands
    return []


def _scale_offset(item, key):
    """DN -> surface reflectance.

    Earth Search re-processes the COGs: when `earthsearch:boa_offset_applied`
    is true the +1000 DN offset of baseline >= 04.00 has ALREADY been removed
    from the pixels, even though `raster:bands` still advertises offset -0.1
    (checked on the 2026-07-06 scene: min red DN = 268, so no +1000 left).
    Applying it twice pushes red below zero and saturates NDVI at 1.
    """
    asset = item.assets[key]
    bands = asset.extra_fields.get("raster:bands") or [{}]
    scale = float(bands[0].get("scale", 1e-4))
    if item.properties.get("earthsearch:boa_offset_applied") is True:
        return scale, 0.0
    return scale, float(bands[0].get("offset", 0.0))


def read_scene(item) -> dict:
    """Windowed read of red / nir / swir16 clipped to the bbox (10 m grid)."""
    import rasterio
    from affine import Affine
    from rasterio.enums import Resampling
    from rasterio.windows import from_bounds

    out = {}
    env = rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif",
        GDAL_HTTP_USERAGENT=USER_AGENT,
        GDAL_HTTP_TIMEOUT="45",
        GDAL_HTTP_MAX_RETRY="3",
        GDAL_HTTP_RETRY_DELAY="2",
        AWS_NO_SIGN_REQUEST="YES",
    )
    with env:
        with rasterio.open(item.assets["red"].href) as src:
            crs = src.crs.to_string()
            left, bottom, right, top = utm_grid_for_bbox(crs)
            win = from_bounds(left, bottom, right, top, src.transform).round_offsets().round_lengths()
            red = src.read(1, window=win)
            h, w = red.shape
        with rasterio.open(item.assets["nir"].href) as src:
            win = from_bounds(left, bottom, right, top, src.transform).round_offsets().round_lengths()
            nir = src.read(1, window=win)
        with rasterio.open(item.assets["swir16"].href) as src:  # 20 m -> 10 m
            win = from_bounds(left, bottom, right, top, src.transform).round_offsets().round_lengths()
            swir = src.read(1, window=win, out_shape=(h, w), resampling=Resampling.bilinear)
    if nir.shape != red.shape or swir.shape != red.shape:
        raise RuntimeError(f"band shapes differ: {red.shape} {nir.shape} {swir.shape}")
    out["red"], out["nir"], out["swir"] = red, nir, swir
    out["transform"] = Affine(PIXEL_M, 0, left, 0, -PIXEL_M, top)
    out["crs"] = crs
    out["scale_offset"] = {k: _scale_offset(item, k) for k in ("red", "nir", "swir16")}
    return out


def download_scene() -> None:
    """Search, read the best scene and write satellite/cache/scene.{npz,json}."""
    cands = search_scenes()
    if not cands:
        raise RuntimeError("no Sentinel-2 scene found")
    last_err = None
    for item in cands[:5]:
        try:
            log(f"reading {item.id} (cloud {item.properties.get('eo:cloud_cover')}%)")
            data = read_scene(item)
            nodata = float(np.mean(data["red"] == 0))
            if nodata > 0.01:
                raise RuntimeError(f"{nodata:.1%} nodata inside the bbox")
            break
        except Exception as exc:  # try the next least-cloudy scene
            last_err = exc
            log(f"  failed: {exc}")
            data = None
    if data is None:
        raise RuntimeError(f"could not read any scene: {last_err}")

    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(CACHE_DIR / "scene.npz", red=data["red"], nir=data["nir"], swir=data["swir"])
    t = data["transform"]
    meta = {
        "scene_id": item.id,
        "scene_date": (item.properties.get("datetime") or "")[:10],
        "scene_datetime": item.properties.get("datetime"),
        "cloud_cover": item.properties.get("eo:cloud_cover"),
        "mgrs_tile": item.properties.get("grid:code"),
        "processing_baseline": item.properties.get("s2:processing_baseline"),
        "boa_offset_applied": item.properties.get("earthsearch:boa_offset_applied"),
        "crs": data["crs"],
        "transform": [t.a, t.b, t.c, t.d, t.e, t.f],
        "scale_offset": data["scale_offset"],
        "hrefs": {k: item.assets[k].href for k in ("red", "nir", "swir16")},
        "downloaded_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    (CACHE_DIR / "scene.json").write_text(json.dumps(meta, indent=2))
    log(f"cached {item.id} -> {CACHE_DIR}/scene.npz  shape={data['red'].shape}")


def load_cached_scene() -> Scene:
    from affine import Affine

    meta = json.loads((CACHE_DIR / "scene.json").read_text())
    arr = np.load(CACHE_DIR / "scene.npz")

    def refl(name, key):
        scale, offset = meta["scale_offset"][key]
        dn = arr[name].astype("float32")
        r = dn * scale + offset
        r[dn == 0] = np.nan
        return r

    red, nir, swir = refl("red", "red"), refl("nir", "nir"), refl("swir", "swir16")
    with np.errstate(invalid="ignore", divide="ignore"):
        ndvi = (nir - red) / (nir + red)
        ndmi = (nir - swir) / (nir + swir)
    ndvi = np.clip(ndvi, -1, 1).astype("float32")
    ndmi = np.clip(ndmi, -1, 1).astype("float32")
    return Scene(
        ndvi=ndvi,
        ndmi=ndmi,
        transform=Affine(*meta["transform"]),
        crs=meta["crs"],
        source=SOURCE_REAL,
        scene_id=meta["scene_id"],
        scene_date=meta["scene_date"],
        cloud_cover=meta["cloud_cover"],
        extra={
            "mgrs_tile": meta.get("mgrs_tile"),
            "median_red_reflectance": round(float(np.nanmedian(red)), 4),
            "median_nir_reflectance": round(float(np.nanmedian(nir)), 4),
        },
    )


# --------------------------------------------------------------------------
# 6. Synthetic fallback (seeded): a fake NDVI raster, then the same processing
# --------------------------------------------------------------------------
def make_synthetic_scene() -> Scene:
    from affine import Affine
    from pyproj import Transformer
    from scipy import ndimage as ndi

    rng = np.random.default_rng(SYNTH_SEED)
    crs = "EPSG:32632"
    left, bottom, right, top = utm_grid_for_bbox(crs)
    w = int(round((right - left) / PIXEL_M))
    h = int(round((top - bottom) / PIXEL_M))
    transform = Affine(PIXEL_M, 0, left, 0, -PIXEL_M, top)
    xs = left + (np.arange(w) + 0.5) * PIXEL_M
    ys = top - (np.arange(h) + 0.5) * PIXEL_M
    xx, yy = np.meshgrid(xs, ys)
    to_utm = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    cx, cy = to_utm.transform(TOWN_CENTER[1], TOWN_CENTER[0])

    # grove centres: around plots.geojson if present, else a ring around the town
    centres = []
    if PLOTS_GEOJSON.exists():
        try:
            from shapely.geometry import shape

            fc = json.loads(PLOTS_GEOJSON.read_text())
            pts = [shape(f["geometry"]).centroid for f in fc.get("features", []) if f.get("geometry")]
            if pts:
                px, py = to_utm.transform(np.mean([p.x for p in pts]), np.mean([p.y for p in pts]))
                centres.append((px, py, 550.0, 450.0, 0.0))
        except Exception as exc:
            log(f"plots.geojson ignored ({exc})")
    for k in range(9):  # historic palm grove: crescent around the town
        ang = math.radians(-30 + k * 30 + rng.uniform(-10, 10))
        dist = rng.uniform(900, 1900)
        centres.append((cx + dist * math.cos(ang), cy + dist * math.sin(ang),
                        rng.uniform(350, 650), rng.uniform(280, 480), rng.uniform(0, math.pi)))
    for _ in range(14):  # scattered private extensions further out
        ang = rng.uniform(0, 2 * math.pi)
        dist = rng.uniform(2300, 3600)
        centres.append((cx + dist * math.cos(ang), cy + dist * math.sin(ang),
                        rng.uniform(70, 190), rng.uniform(60, 150), rng.uniform(0, math.pi)))

    grove = np.zeros((h, w), dtype="float32")
    for (px, py, ra, rb, rot) in centres:
        dx, dy = xx - px, yy - py
        u = dx * math.cos(rot) + dy * math.sin(rot)
        v = -dx * math.sin(rot) + dy * math.cos(rot)
        grove = np.maximum(grove, np.exp(-((u / ra) ** 2 + (v / rb) ** 2)))
    warp = ndi.gaussian_filter(rng.normal(size=(h, w)), 12)
    warp = warp / (np.abs(warp).max() + 1e-9)
    inside = (grove + 0.18 * warp) > 0.42
    # built-up core of the town; two 20 m wide tracks crossing the groves
    inside &= np.hypot(xx - cx, yy - cy) > 480
    tracks = (np.abs((xx - cx) * 0.5 + (yy - cy) - 900) < 11) | (np.abs((xx - cx) - 0.3 * (yy - cy) + 1300) < 11)

    density = ndi.gaussian_filter(rng.normal(size=(h, w)), 5)
    density = density / (np.abs(density).max() + 1e-9)
    ndvi = 0.085 + 0.02 * rng.normal(size=(h, w))
    canopy = 0.46 + 0.16 * density + 0.035 * rng.normal(size=(h, w))
    ndvi = np.where(inside, canopy, ndvi)
    ndvi = np.where(inside & tracks, 0.13 + 0.02 * rng.normal(size=(h, w)), ndvi)
    ndvi = np.clip(ndvi, -0.05, 0.85).astype("float32")
    ndmi = np.clip(0.6 * ndvi - 0.12 + 0.02 * rng.normal(size=(h, w)), -1, 1).astype("float32")
    return Scene(ndvi=ndvi, ndmi=ndmi, transform=transform, crs=crs, source=SOURCE_SYNTH,
                 scene_id=None, scene_date=None, cloud_cover=None,
                 extra={"synthetic_seed": SYNTH_SEED, "seeded_from_plots": PLOTS_GEOJSON.exists()})


# --------------------------------------------------------------------------
# Inputs: ET0 and registry
# --------------------------------------------------------------------------
def july_et0() -> tuple[float, str]:
    try:
        days = json.loads(WEATHER_JSON.read_text())["days"]
        vals = [float(d["et0"]) for d in days if d["date"][5:7] == "07" and d.get("et0") is not None]
        if vals:
            return round(float(np.mean(vals)), 2), f"mean July ET0 from data/weather.json ({len(vals)} days, Open-Meteo)"
    except Exception as exc:
        log(f"weather.json unusable ({exc}); using fallback ET0")
    return ET0_FALLBACK_MM, "fallback constant"


def load_registry() -> list[dict]:
    wells = []
    if not REGISTRY_CSV.exists():
        return wells
    with REGISTRY_CSV.open(newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            try:
                lat, lon = float(row["lat"]), float(row["lon"])
            except (KeyError, TypeError, ValueError):
                continue
            if math.isfinite(lat) and math.isfinite(lon):
                wells.append({"id": row.get("id"), "lat": lat, "lon": lon})
    return wells


# --------------------------------------------------------------------------
# 2-5. Processing
# --------------------------------------------------------------------------
def histogram_report(ndvi: np.ndarray) -> dict:
    v = ndvi[np.isfinite(ndvi)]
    edges = np.round(np.arange(-0.1, 0.9001, 0.05), 2)
    counts, _ = np.histogram(v, bins=edges)
    log("NDVI histogram (share of pixels):")
    for lo, c in zip(edges[:-1], counts):
        share = c / v.size
        log(f"  {lo:+.2f}..{lo + 0.05:+.2f}  {share:6.2%}  {'#' * int(round(share * 120))}")
    # Otsu threshold, for information
    hc, he = np.histogram(v, bins=256, range=(-0.2, 1.0))
    p = hc / hc.sum()
    mids = (he[:-1] + he[1:]) / 2
    w0 = np.cumsum(p)
    m0 = np.cumsum(p * mids)
    mt = m0[-1]
    with np.errstate(divide="ignore", invalid="ignore"):
        between = (mt * w0 - m0) ** 2 / (w0 * (1 - w0))
    otsu = float(mids[np.nanargmax(between)])
    pct = {f"p{q}": round(float(np.percentile(v, q)), 3) for q in (5, 50, 75, 90, 95, 99)}
    log(f"NDVI percentiles {pct}  Otsu={otsu:.3f}")
    return {"otsu": round(otsu, 3), **pct}


def split_patches(labels: np.ndarray, ndvi: np.ndarray) -> np.ndarray:
    """Split connected components into grove-scale patches.

    Thresholding alone returns one blob for most of the oasis, which makes a
    per-patch "well within 400 m" test meaningless. Marker-based watershed on
    the smoothed NDVI: seeds are the local maxima (dense canopy cores), regions
    grow downhill (4-neighbours, inside the mask only) and meet along the NDVI
    valleys (tracks, drains, sparser strips). Regions are connected by
    construction and never cross a gap in the mask.
    """
    import heapq

    from scipy import ndimage as ndi

    mask = labels > 0
    sm = ndi.gaussian_filter(np.where(mask, np.nan_to_num(ndvi), 0.0).astype("float64"), SPLIT_SIGMA_PX)
    peaks = (ndi.maximum_filter(sm, size=SPLIT_MARKER_PX) == sm) & mask
    ids = np.arange(1, int(labels.max()) + 1)
    has_peak = ndi.maximum(peaks, labels, ids) > 0
    for pos in ndi.maximum_position(sm, labels, ids[~has_peak]):  # one seed per component at least
        peaks[pos] = True
    rr, cc = np.nonzero(peaks)
    h, w = labels.shape
    out = [[0] * w for _ in range(h)]
    inside = mask.tolist()
    val = sm.tolist()
    heap = []
    for k, (r, c) in enumerate(zip(rr.tolist(), cc.tolist()), start=1):
        out[r][c] = k
        heap.append((-val[r][c], r, c))
    heapq.heapify(heap)
    while heap:
        _, r, c = heapq.heappop(heap)
        lab = out[r][c]
        for r2, c2 in ((r + 1, c), (r - 1, c), (r, c + 1), (r, c - 1)):
            if 0 <= r2 < h and 0 <= c2 < w and inside[r2][c2] and out[r2][c2] == 0:
                out[r2][c2] = lab
                heapq.heappush(heap, (-val[r2][c2], r2, c2))
    return np.asarray(out, dtype="int32")


def write_ndvi_png(scene: Scene, threshold: float, path: Path) -> None:
    from PIL import Image
    from rasterio.transform import from_bounds
    from rasterio.warp import Resampling, reproject

    w = PNG_MAX_WIDTH
    h = int(round(w * (BBOX[3] - BBOX[1]) / (BBOX[2] - BBOX[0])))
    dst = np.full((h, w), np.nan, dtype="float32")
    reproject(
        source=scene.ndvi, destination=dst,
        src_transform=scene.transform, src_crs=scene.crs, src_nodata=np.nan,
        dst_transform=from_bounds(*BBOX, w, h), dst_crs="EPSG:4326", dst_nodata=np.nan,
        resampling=Resampling.bilinear,
    )
    t = np.clip((np.nan_to_num(dst, nan=-1.0) - threshold) / (0.75 - threshold), 0, 1)
    t = np.round(t * 15) / 15  # 16 colour steps: much smaller PNG
    stops = np.array([[214, 239, 160], [120, 198, 121], [35, 132, 67], [0, 69, 41]], dtype="float32")
    pos = t * (len(stops) - 1)
    i0 = np.minimum(pos.astype(int), len(stops) - 2)
    frac = (pos - i0)[..., None]
    rgb = stops[i0] * (1 - frac) + stops[i0 + 1] * frac
    alpha = np.where(np.nan_to_num(dst, nan=-1.0) >= threshold, 165 + 80 * t, 0)
    rgba = np.dstack([rgb, alpha]).round().astype("uint8")
    rgba[alpha == 0] = 0
    Image.fromarray(rgba, "RGBA").save(path, optimize=True)


def round_coords(obj, nd=6):
    if isinstance(obj, (list, tuple)):
        return [round_coords(o, nd) for o in obj]
    return round(float(obj), nd)


def site_suggestions(mask: np.ndarray, inside: np.ndarray, lon, lat, scene: Scene) -> list[dict]:
    from pyproj import Transformer
    from scipy import ndimage as ndi

    wx = int(round(SITE_WINDOW_M[0] / PIXEL_M))
    wy = int(round(SITE_WINDOW_M[1] / PIXEL_M))
    frac = ndi.uniform_filter(mask.astype("float32"), size=(wy, wx), mode="constant")
    cover = ndi.uniform_filter(inside.astype("float32"), size=(wy, wx), mode="constant")
    to_utm = Transformer.from_crs("EPSG:4326", scene.crs, always_xy=True)
    cx, cy = to_utm.transform(TOWN_CENTER[1], TOWN_CENTER[0])
    h, w = mask.shape
    xs = scene.transform.c + (np.arange(w) + 0.5) * scene.transform.a
    ys = scene.transform.f + (np.arange(h) + 0.5) * scene.transform.e
    dist = np.hypot(xs[None, :] - cx, ys[:, None] - cy)
    score = frac - SITE_DIST_PENALTY_PER_KM * dist / 1000.0
    ok = (cover > 0.999) & (dist >= SITE_MIN_DIST_M)
    score = np.where(ok, score, -np.inf)
    out = []
    for _ in range(3):
        idx = int(np.argmax(score))
        r, c = divmod(idx, w)
        if not np.isfinite(score[r, c]):
            break
        dx, dy = xs[c] - cx, ys[r] - cy
        out.append({
            "center_lat": round(float(lat[r, c]), 5),
            "center_lon": round(float(lon[r, c]), 5),
            "irrigated_fraction": round(float(frac[r, c]), 3),
            "distance_to_town_km": round(float(dist[r, c]) / 1000.0, 2),
            "bearing_from_town_deg": round((math.degrees(math.atan2(dx, dy)) + 360) % 360),
            "window_m": {"east_west": SITE_WINDOW_M[0], "north_south": SITE_WINDOW_M[1]},
        })
        # forbid overlapping windows
        score[max(0, r - wy):r + wy + 1, max(0, c - wx):c + wx + 1] = -np.inf
    return out


def process(scene: Scene, out_dir: Path, private_dir: Path, threshold: float,
            hex_min_patches: int, note_extra: str = "", no_split: bool = False) -> dict:
    import h3
    import shapely
    from pyproj import Transformer
    from rasterio import features
    from scipy import ndimage as ndi
    from shapely.geometry import mapping, shape

    out_dir.mkdir(parents=True, exist_ok=True)
    private_dir.mkdir(parents=True, exist_ok=True)

    ndvi, ndmi = scene.ndvi, scene.ndmi
    lon, lat = pixel_lonlat(scene.transform, scene.crs, ndvi.shape)
    eps = 1.2e-4  # ~1 pixel: keep whole pixels (and their polygons) inside the bbox
    inside = ((lon > BBOX[0] + eps) & (lon < BBOX[2] - eps) &
              (lat > BBOX[1] + eps) & (lat < BBOX[3] - eps) & np.isfinite(ndvi))

    hist = histogram_report(np.where(inside, ndvi, np.nan))

    # ---- 2. mask, morphology, connected components
    raw = inside & (ndvi >= threshold)
    cross = ndi.generate_binary_structure(2, 1)
    mask = ndi.binary_opening(raw, structure=cross)  # removes isolated pixels / 1-px spurs
    mask = ndi.binary_closing(mask, structure=cross) & inside  # fills 1-px gaps only
    labels, n_comp = ndi.label(mask, structure=cross)  # 4-connectivity -> valid polygons
    min_px = int(math.ceil(MIN_PATCH_HA / PIXEL_HA))
    comp_sizes = np.bincount(labels.ravel(), minlength=n_comp + 1)
    small = comp_sizes < min_px
    small[0] = True
    labels[small[labels]] = 0
    comp_ha = np.sort(comp_sizes[~small])[::-1] * PIXEL_HA
    log(f"{n_comp} connected components, {len(comp_ha)} >= {MIN_PATCH_HA} ha; largest (ha): "
        f"{[round(float(a), 1) for a in comp_ha[:4]]}")
    if not no_split:
        labels = split_patches(labels, ndvi)
    n = int(labels.max())
    sizes = np.bincount(labels.ravel(), minlength=n + 1)
    keep = sizes >= min_px
    keep[0] = False
    order = np.argsort(-sizes * keep, kind="stable")[: int(keep.sum())]  # big -> small
    remap = np.zeros(n + 1, dtype="int32")
    remap[order] = np.arange(1, len(order) + 1)
    labels = remap[labels]
    n_patches = len(order)
    mask = labels > 0
    log(f"threshold {threshold}: raw {raw.sum() * PIXEL_HA:.1f} ha, kept {mask.sum() * PIXEL_HA:.1f} ha in "
        f"{n_patches} patches >= {MIN_PATCH_HA} ha ({'no split' if no_split else 'watershed split'})")
    if n_patches == 0:
        raise RuntimeError("no irrigated patch found")

    idx = np.arange(1, n_patches + 1)
    px_count = np.bincount(labels.ravel(), minlength=n_patches + 1)[1:]
    area_ha = px_count * PIXEL_HA
    ndvi_mean = ndi.mean(ndvi, labels, idx)
    ndmi_mean = ndi.mean(np.nan_to_num(ndmi), labels, idx)

    # ---- 3. water use
    et0, et0_src = july_et0()
    m3_per_ha = 10.0 * KC_DATE_PALM * et0 / IRRIGATION_EFFICIENCY
    est_m3 = area_ha * m3_per_ha

    # ---- vectorise (UTM), one polygon per patch
    geoms = {}
    for geom, val in features.shapes(labels, mask=mask, connectivity=4, transform=scene.transform):
        g = shape(geom)
        v = int(val)
        geoms[v] = g if v not in geoms else geoms[v].union(g)

    # ---- 4. registry comparison
    wells = load_registry()
    to_utm = Transformer.from_crs("EPSG:4326", scene.crs, always_xy=True)
    to_ll = Transformer.from_crs(scene.crs, "EPSG:4326", always_xy=True)
    nearest_m = np.full(n_patches, np.inf)
    nearest_id = [None] * n_patches
    if wells:
        wx, wy = to_utm.transform([w["lon"] for w in wells], [w["lat"] for w in wells])
        pts = shapely.points(np.asarray(wx), np.asarray(wy))
        for i in idx:
            d = shapely.distance(geoms[int(i)], pts)
            j = int(np.argmin(d))
            nearest_m[i - 1] = float(d[j])
            nearest_id[i - 1] = wells[j]["id"]
    unrecorded = nearest_m > WELL_RADIUS_M  # all True when the registry is empty

    # ---- H3 aggregation: each irrigated 10 m pixel goes to its own hexagon
    rr, cc = np.nonzero(mask)
    plab = labels[rr, cc]
    plat, plon = lat[rr, cc], lon[rr, cc]
    hexes: dict[str, dict] = {}
    for la, lo, lb in zip(plat.tolist(), plon.tolist(), plab.tolist()):
        cell = h3.latlng_to_cell(la, lo, H3_RES)
        rec = hexes.get(cell)
        if rec is None:
            rec = hexes[cell] = {"px": 0, "px_unrec": 0, "patches": set()}
        rec["px"] += 1
        rec["patches"].add(lb)
        if unrecorded[lb - 1]:
            rec["px_unrec"] += 1

    hex_features = []
    n_suppressed = 0
    for cell in sorted(hexes):
        rec = hexes[cell]
        ring = [[lng, la] for la, lng in h3.cell_to_boundary(cell)]
        ring.append(ring[0])
        ha, ha_u = rec["px"] * PIXEL_HA, rec["px_unrec"] * PIXEL_HA
        props = {
            "h3": cell,
            "irrigated_ha": round(ha, 2),
            "est_m3_day": round(ha * m3_per_ha, 1),
            "unrecorded_ha": round(ha_u, 2),
            "unrecorded_m3_day": round(ha_u * m3_per_ha, 1),
        }
        if hex_min_patches and len(rec["patches"]) < hex_min_patches:
            props["unrecorded_ha"] = None
            props["unrecorded_m3_day"] = None
            props["suppressed"] = True
            n_suppressed += 1
        hex_features.append({"type": "Feature", "properties": props,
                             "geometry": {"type": "Polygon", "coordinates": [round_coords(ring)]}})
    single_patch_hexes = sum(1 for r in hexes.values() if len(r["patches"]) == 1)
    (out_dir / "sat_hex.geojson").write_text(
        json.dumps({"type": "FeatureCollection", "features": hex_features}, separators=(",", ":")))

    # ---- 5. patches: public (no recorded/unrecorded information) + private
    def build(tol_m: float):
        pub, priv = [], []
        for i in idx:
            g = geoms[int(i)]
            gs = g.simplify(tol_m, preserve_topology=True) if tol_m > 0 else g
            if gs.is_empty or not gs.is_valid:
                gs = g
            gj = mapping(shapely.transform(gs, lambda xy: np.column_stack(to_ll.transform(xy[:, 0], xy[:, 1]))))
            gj = {"type": gj["type"], "coordinates": round_coords(gj["coordinates"])}
            base = {
                "id": f"P{int(i):04d}",
                "area_ha": round(float(area_ha[i - 1]), 2),
                "ndvi_mean": round(float(ndvi_mean[i - 1]), 3),
                "est_m3_day": round(float(est_m3[i - 1]), 1),
            }
            pub.append({"type": "Feature", "properties": dict(base), "geometry": gj})
            d = nearest_m[i - 1]
            priv.append({"type": "Feature", "geometry": gj, "properties": {
                **base,
                "ndmi_mean": round(float(ndmi_mean[i - 1]), 3),
                "nearest_recorded_well_id": nearest_id[i - 1],
                "nearest_recorded_well_m": (round(float(d), 1) if math.isfinite(d) else None),
                "likely_unrecorded": bool(unrecorded[i - 1]),
            }})
        return pub, priv

    for tol in (4.0, 7.0, 10.0, 15.0, 22.0, 30.0):
        pub, priv = build(tol)
        text = json.dumps({"type": "FeatureCollection", "features": pub}, separators=(",", ":"))
        if len(text.encode()) <= MAX_PATCH_FILE_BYTES:
            break
    log(f"sat_patches.geojson: {len(text.encode()) / 1000:.0f} kB (simplify tolerance {tol} m)")
    (out_dir / "sat_patches.geojson").write_text(text)
    (private_dir / "patches_private.geojson").write_text(json.dumps(
        {"type": "FeatureCollection",
         "private": "NEVER SERVE: per-patch recorded/unrecorded flag",
         "features": priv}, separators=(",", ":")))

    write_ndvi_png(scene, threshold, out_dir / "ndvi.png")

    sites = site_suggestions(mask, inside, lon, lat, scene)
    (private_dir / "site_suggestion.json").write_text(json.dumps({
        "method": "sliding window over the irrigated mask; score = irrigated fraction "
                  f"- {SITE_DIST_PENALTY_PER_KM}/km distance to the town centre; centre >= "
                  f"{SITE_MIN_DIST_M:.0f} m from the centre; windows do not overlap",
        "source": scene.source,
        "candidates": sites,
    }, indent=2))

    total_ha = float(mask.sum() * PIXEL_HA)
    unrec_ha = float(np.sum(area_ha[unrecorded]))
    notes = [
        "Irrigated land detected from dry-season NDVI on 10 m Sentinel-2 pixels; a proxy for "
        "abstraction, not a map of wells.",
        f"Water use = area_ha x 10 x Kc({KC_DATE_PALM}) x ET0 / efficiency({IRRIGATION_EFFICIENCY}); "
        "Kc and efficiency are assumed, not measured.",
        f"'Unrecorded' = irrigated patch with no recorded well within {WELL_RADIUS_M:.0f} m; "
        f"published only aggregated on H3 resolution {H3_RES} hexagons. The registry is synthetic.",
    ]
    if not wells:
        notes.append("Registry missing or empty at run time: unrecorded figures equal the totals "
                     "and are NOT meaningful; re-run with --skip-download once it exists.")
    if scene.source == SOURCE_SYNTH:
        notes.append("SYNTHETIC FALLBACK: the patches are generated (seeded), not observed.")
    if note_extra:
        notes.append(note_extra)
    meta = {
        "source": scene.source,
        "scene_id": scene.scene_id,
        "scene_date": scene.scene_date,
        "cloud_cover": scene.cloud_cover,
        "bbox": BBOX,
        "ndvi_threshold": threshold,
        "kc": KC_DATE_PALM,
        "efficiency": IRRIGATION_EFFICIENCY,
        "et0_mm": et0,
        "n_patches": n_patches,
        "irrigated_ha": round(total_ha, 1),
        "est_m3_day": round(total_ha * m3_per_ha),
        "unrecorded_m3_day": round(unrec_ha * m3_per_ha),
        "registry_wells": len(wells),
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "note": " ".join(notes),
        # extras
        "unrecorded_ha": round(unrec_ha, 1),
        "unrecorded_share": round(unrec_ha / total_ha, 3),
        "et0_source": et0_src,
        "m3_per_ha_day": round(m3_per_ha, 1),
        "well_radius_m": WELL_RADIUS_M,
        "h3_resolution": H3_RES,
        "n_hex": len(hex_features),
        "hex_min_patches": hex_min_patches,
        "min_patch_ha": MIN_PATCH_HA,
        "patch_split": "none" if no_split else "watershed on smoothed NDVI",
        "ndvi_stats": hist,
        "ndvi_png_bounds": {"west": BBOX[0], "south": BBOX[1], "east": BBOX[2], "north": BBOX[3]},
        **scene.extra,
    }
    (out_dir / "sat_meta.json").write_text(json.dumps(meta, indent=2))

    log(f"patches={n_patches}  irrigated={total_ha:.1f} ha  est={total_ha * m3_per_ha:,.0f} m3/day  "
        f"ET0={et0} mm ({et0_src})")
    log(f"registry wells={len(wells)}  unrecorded={unrec_ha:.1f} ha / {unrec_ha * m3_per_ha:,.0f} m3/day")
    log(f"hexes={len(hex_features)} (single-patch hexes: {single_patch_hexes}, suppressed: {n_suppressed})")
    log(f"largest patches (ha): {[round(float(a), 1) for a in area_ha[:6]]}")
    for s in sites:
        log(f"site: {s}")
    log(f"public -> {out_dir}   private -> {private_dir}")
    return meta


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------
def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--synthetic", action="store_true", help="skip Sentinel-2, generate seeded synthetic patches")
    ap.add_argument("--skip-download", action="store_true", help="reuse satellite/cache/ (offline)")
    ap.add_argument("--out", type=Path, default=PUBLIC_DIR, help="public output directory")
    ap.add_argument("--private-out", type=Path, default=PRIVATE_DIR,
                    help="private output directory (never served)")
    ap.add_argument("--threshold", type=float, default=NDVI_THRESHOLD, help="NDVI threshold")
    ap.add_argument("--hex-min-patches", type=int, default=HEX_MIN_PATCHES,
                    help="null the unrecorded_* fields of hexagons holding fewer distinct patches than this")
    ap.add_argument("--no-split", action="store_true",
                    help="keep raw connected components (do not split big blobs into grove-scale patches)")
    args = ap.parse_args(argv)

    scene, note = None, ""
    if not args.synthetic:
        try:
            cached = (CACHE_DIR / "scene.npz").exists() and (CACHE_DIR / "scene.json").exists()
            if args.skip_download:
                if not cached:
                    raise RuntimeError("--skip-download but satellite/cache/ is empty")
                log("using cached scene")
            else:
                try:
                    download_scene()
                except Exception as exc:
                    if not cached:
                        raise
                    log(f"download failed ({type(exc).__name__}: {exc}) -> reusing cached real scene")
                    note = "Download failed at run time; the cached Sentinel-2 scene was reused."
            scene = load_cached_scene()
            log(f"scene {scene.scene_id} {scene.scene_date} cloud={scene.cloud_cover}% "
                f"shape={scene.ndvi.shape} crs={scene.crs} {scene.extra}")
        except Exception as exc:
            log(f"REAL PIPELINE FAILED ({type(exc).__name__}: {exc}) -> synthetic fallback")
            note = f"Automatic fallback: real pipeline failed ({type(exc).__name__})."
            scene = None
    if scene is None:
        scene = make_synthetic_scene()
        log("synthetic scene generated")
    process(scene, args.out, args.private_out, args.threshold, args.hex_min_patches, note, args.no_split)
    return 0


if __name__ == "__main__":
    sys.exit(main())
