"""Build the Cable Turf map data from raw downloads.

Reads data-raw/ and writes docs/data/. Standard library only.

    python3 pipeline/build.py

Availability comes from the FCC's New York files in data-raw/fcc/.
"""

import csv
import datetime as dt
import io
import json
import math
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data-raw"
OUT = ROOT / "docs" / "data"

COUNTIES = {"36005": "Bronx", "36047": "Brooklyn", "36061": "Manhattan",
            "36081": "Queens", "36085": "Staten Island"}

CABLE, FIBER, WIRELESS = 40, 50, 71

# Wireless home internet providers shown in the block readout, never counted as a wire.
WIRELESS_FLAGS = {"Verizon": 1, "T-Mobile": 2, "Starry Inc": 4}

# The City's franchise map still names the 2016 holders.
FRANCHISE = {"Time Warner": "S", "Cablevision": "O"}

# The neighborhood the front page's story names, as NYC Planning spells it.
STORY_PLACE = "Harlem (North)"

# Coordinates are stored as integers of 1e-5 degrees, about a meter.
SCALE = 100_000

# Douglas-Peucker tolerances in degrees of latitude: blocks keep about
# 2.5 m, the franchise line 10 m and the NYC outline 40 m.
TOLERANCE = 0.000025
LINE_TOLERANCE = 0.00009
OUTLINE_TOLERANCE = 0.00036
LON_FACTOR = math.cos(math.radians(40.7))


# ---- Availability ---------------------------------------------------

# FCC brand names, matched by their start, to the names classify() reads.
BRANDS = {"spectrum": "Spectrum", "optimum": "Optimum", "verizon": "Verizon",
          "astound": "Astound Broadband", "t-mobile": "T-Mobile", "starry": "Starry Inc"}

PERIOD = re.compile(r"_(J|D)(\d\d)_")


def fcc_files():
    folder = RAW / "fcc"
    if not folder.exists():
        return []

    # An unzipped CSV beside its zip is the same file, so read the zip only.
    zips = sorted(folder.glob("*.zip"))
    zipped = {z.name.removesuffix(".zip").removesuffix(".csv") for z in zips}
    return [c for c in sorted(folder.glob("*.csv")) if c.stem not in zipped] + zips


def fcc_rows(path):
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            for name in z.namelist():
                if name.endswith(".csv"):
                    with z.open(name) as f:
                        yield from csv.DictReader(io.TextIOWrapper(f, encoding="utf-8"))
    else:
        with open(path, newline="", encoding="utf-8") as f:
            yield from csv.DictReader(f)


def read_fcc(files):
    """Block totals and provider rows from the FCC's availability CSVs.

    Counts home service only. A block's total is the buildings where any
    company claims residential or mixed service, so a building only
    businesses can order at drops out of both sides of every share.
    """
    need = {"brand_name", "location_id", "technology", "business_residential_code", "block_geoid"}
    locations = defaultdict(set)
    served = defaultdict(lambda: defaultdict(set))
    unknown = Counter()
    periods = set()
    techs = set()

    for path in files:
        m = PERIOD.search(path.name)
        if m:
            periods.add(("June " if m.group(1) == "J" else "December ") + "20" + m.group(2))
        for i, r in enumerate(fcc_rows(path)):
            if i == 0:
                missing = need - set(r)
                assert not missing, f"{path.name} lacks {sorted(missing)}; header is {sorted(r)}"
            g = r["block_geoid"]
            if g[:5] not in COUNTIES:
                continue
            techs.add(int(r["technology"]))

            # R is residential and X is both. B is business only.
            if r["business_residential_code"] not in ("R", "X"):
                continue
            locations[g].add(r["location_id"])
            brand = r["brand_name"].strip().lower()
            name = next((v for k, v in BRANDS.items() if brand.startswith(k)), None)
            if name is None:
                unknown[r["brand_name"]] += 1
                continue

            # A cable company's fiber is still its own wire, so it joins its cable claims.
            tech = int(r["technology"])
            if name in ("Spectrum", "Optimum") and tech == FIBER:
                tech = CABLE
            served[g][(name, tech)].add(r["location_id"])

    if unknown:
        print("Brands left out:", ", ".join(f"{n} ({c})" for n, c in unknown.most_common(8)))
    assert len(periods) <= 1, f"Files mix reporting periods: {sorted(periods)}"
    absent = {CABLE, FIBER, WIRELESS} - techs
    assert not absent, (f"data-raw/fcc/ has no rows for technology {sorted(absent)}; "
                        "it needs the cable, fiber and licensed fixed wireless files")

    total = {g: len(s) for g, s in locations.items()}
    rows = {g: {k: len(s) for k, s in d.items()} for g, d in served.items()}
    return total, rows, {
        "source": "FCC Broadband Data Collection, fixed availability files for New York",
        "period": periods.pop() if periods else "unknown", "residential_only": True
    }


def classify(t, r):
    s = r.get(("Spectrum", CABLE), 0)
    o = r.get(("Optimum", CABLE), 0)
    v = min(t, r.get(("Verizon", FIBER), 0))
    a = min(t, max(r.get(("Astound Broadband", CABLE), 0), r.get(("Astound Broadband", FIBER), 0)))
    w = sum(bit for name, bit in WIRELESS_FLAGS.items() if r.get((name, WIRELESS), 0))

    # A block both companies reach counts as one company's turf when that
    # company reports at least four times the other's buildings.
    if s and o:
        h = "S" if s >= 4 * o else "O" if o >= 4 * s else "B"
    else:
        h = "S" if s else "O" if o else "A" if a else "N"
    return {"h": h, "t": t, "v": v, "a": a, "w": w}


# ---- Geometry -------------------------------------------------------

def simplify(ring, tol=TOLERANCE, closed=True):
    """Douglas-Peucker on one ring or line, in roughly equal-area units."""
    pts = [(x * LON_FACTOR, y) for x, y in ring]
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        i, j = stack.pop()
        (x1, y1), (x2, y2) = pts[i], pts[j]
        dx, dy = x2 - x1, y2 - y1
        norm = math.hypot(dx, dy)
        far, idx = 0.0, None
        for k in range(i + 1, j):
            px, py = pts[k]
            d = (abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm
                 if norm else math.hypot(px - x1, py - y1))
            if d > far:
                far, idx = d, k
        if idx is not None and far > tol:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    out = [ring[k] for k in range(len(ring)) if keep[k]]
    return out if len(out) >= (4 if closed else 2) else None


def area(ring):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:]))) / 2 * LON_FACTOR


def inside(x, y, ring):
    hit = False
    for (ax, ay), (bx, by) in zip(ring, ring[1:]):
        if (ay > y) != (by > y) and x < (bx - ax) * (y - ay) / (by - ay) + ax:
            hit = not hit
    return hit


def encode(ring, origin):
    """Quantize a ring and store it as deltas: x0, y0, dx1, dy1, ..."""
    flat, px, py = [], origin[0], origin[1]
    for x, y in ring[:-1]:
        qx, qy = round(x * SCALE), round(y * SCALE)
        flat += [qx - px, qy - py]
        px, py = qx, qy
    return flat


def rounded(pts):
    return [[round(x, 5), round(y, 5)] for x, y in pts]


# ---- Franchise map --------------------------------------------------

def read_franchise():
    """The City's franchise areas: a lookup, the line between them, an outline."""
    features = json.loads((RAW / "nyc" / "franchise-areas.geojson").read_text())["features"]
    parts, owner = [], defaultdict(set)

    for f in features:
        who = FRANCHISE[f["properties"]["franchisee"]]
        for poly in f["geometry"]["coordinates"]:
            outer = [tuple(p) for p in poly[0]]
            xs, ys = [p[0] for p in outer], [p[1] for p in outer]
            parts.append((min(xs), min(ys), max(xs), max(ys), outer, who))
            for ring in poly:
                pts = [(round(x, 6), round(y, 6)) for x, y in ring]
                for a, b in zip(pts, pts[1:]):
                    if a != b:
                        owner[frozenset((a, b))].add(who)

    # The franchise line is every edge that one area shares with the other.
    nbrs = defaultdict(list)
    for e, who in owner.items():
        if len(who) == 2:
            a, b = tuple(e)
            nbrs[a].append(b)
            nbrs[b].append(a)
    seen, lines = set(), []
    starts = [p for p in nbrs if len(nbrs[p]) != 2] + list(nbrs)
    for s in starts:
        for n in nbrs[s]:
            if frozenset((s, n)) in seen:
                continue
            line, prev, cur = [s], s, n
            seen.add(frozenset((s, n)))
            while True:
                line.append(cur)
                nxt = [q for q in nbrs[cur] if frozenset((cur, q)) not in seen]
                if len(nbrs[cur]) != 2 or not nxt:
                    break
                seen.add(frozenset((cur, nxt[0])))
                prev, cur = cur, nxt[0]
            line = simplify(line, LINE_TOLERANCE, closed=False)
            if line:
                lines.append(rounded(line))

    outline = []
    for x0, y0, x1, y1, outer, who in parts:
        ring = simplify(outer, OUTLINE_TOLERANCE)
        if ring and area(ring) > 1.6e-7:
            outline.append([rounded(ring)])

    def lookup(x, y):
        for x0, y0, x1, y1, outer, who in parts:
            if x0 <= x <= x1 and y0 <= y <= y1 and inside(x, y, outer):
                return who
        return ""

    return lookup, lines, outline


# ---- Neighborhoods --------------------------------------------------

def read_places():
    """NYC Planning's 2020 NTAs: their names and a point lookup by index."""
    features = json.loads((RAW / "nyc" / "nta2020.geojson").read_text())["features"]
    names, parts = [], []
    for f in features:
        names.append(f["properties"]["ntaname"])
        for poly in f["geometry"]["coordinates"]:
            outer = [tuple(p) for p in poly[0]]
            holes = [[tuple(p) for p in r] for r in poly[1:]]
            xs, ys = [p[0] for p in outer], [p[1] for p in outer]
            parts.append((min(xs), min(ys), max(xs), max(ys), outer, holes, len(names) - 1))

    def lookup(x, y):
        for x0, y0, x1, y1, outer, holes, i in parts:
            if (x0 <= x <= x1 and y0 <= y <= y1 and inside(x, y, outer)
                    and not any(inside(x, y, h) for h in holes)):
                return i
        return -1

    return names, lookup


def anchor(geom):
    """A point for a block: the mean of its largest outer ring."""
    ring = max((poly[0] for poly in geom["coordinates"]), key=len)
    pts = ring[:-1] or ring
    return sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)


def near(lines, meters):
    """Whether a point lies within some meters of any line."""
    kx, ky = 111320 * LON_FACTOR, 110540
    segs = [(x1 * kx, y1 * ky, x2 * kx, y2 * ky)
            for line in lines for (x1, y1), (x2, y2) in zip(line, line[1:])]

    def test(x, y):
        x, y = x * kx, y * ky
        for ax, ay, bx, by in segs:
            dx, dy = bx - ax, by - ay
            t = max(0, min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy or 1)))
            if math.hypot(ax + t * dx - x, ay + t * dy - y) <= meters:
                return True
        return False

    return test


# ---- Build ----------------------------------------------------------

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    files = fcc_files()
    assert files, "data-raw/fcc/ is empty; the README says which FCC files to download"
    total, rows, origin_meta = read_fcc(files)
    blocks = json.loads((RAW / "census2020" / "blocks.json").read_text())
    franchise_of, lines, outline = read_franchise()
    places, place_of = read_places()
    by_line = near(lines, 500)

    origin = (round(-74.26 * SCALE), round(40.49 * SCALE))
    features = []
    city, boro, story = Counter(), defaultdict(Counter), Counter()
    table = []
    vertices = 0

    for b in blocks:
        g = b["geoid"]
        rec = classify(total.get(g, 0), rows.get(g, {}))
        polys = []
        for poly in b["the_geom"]["coordinates"]:
            rings = [r for r in (simplify(ring) for ring in poly) if r]
            if rings:
                polys.append([encode(r, origin) for r in rings])
                vertices += sum(len(r) - 1 for r in rings)
        if not polys:
            continue
        point = anchor(b["the_geom"])
        place = place_of(*point)
        features.append([rec["h"], rec["t"], rec["v"], rec["a"], rec["w"], polys, place])

        t = rec["t"]
        if t <= 0:
            continue
        name = COUNTIES[g[:5]]
        fr = franchise_of(*point)
        cable_only = max(0, t - rec["v"] - rec["a"])
        line_side = rec["h"] == "B" and by_line(*point)
        groups = [city, boro[name]] + ([story] if place >= 0 and places[place] == STORY_PLACE else [])
        for c in groups:
            c["both_near_line"] += t if line_side else 0
            c["locations"] += t
            c["verizon"] += rec["v"]
            c["astound"] += rec["a"]
            c["one_wire_floor"] += cable_only
            c["turf_" + rec["h"]] += t
            if rec["h"] in "SO" and fr:
                c["franchise_checked"] += t
                c["franchise_match"] += t if rec["h"] == fr else 0
        table.append({"block": g, "borough": name, "cable_turf": rec["h"], "franchise": fr,
                      "locations": t, "verizon_fiber": rec["v"], "astound": rec["a"],
                      "cable_only_min": cable_only,
                      "wireless": ";".join(n for n, bit in WIRELESS_FLAGS.items() if rec["w"] & bit)})

    (OUT / "blocks.json").write_text(json.dumps(
        {"scale": SCALE, "origin": origin,
         "fields": ["turf", "locations", "verizon_fiber", "astound", "wireless", "geometry", "place"],
         "places": places, "blocks": features}, separators=(",", ":")))

    (OUT / "city.json").write_text(json.dumps(
        {"franchise_line": {"type": "MultiLineString", "coordinates": lines},
         "outline": {"type": "MultiPolygon", "coordinates": outline}}, separators=(",", ":")))

    with open(OUT / "cable-turf-blocks.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(table[0]))
        w.writeheader()
        w.writerows(table)

    def summary(c):
        n = c["locations"]
        return {
            "locations": n,
            "one_company_turf_pct": round(100 * (c["turf_S"] + c["turf_O"]) / n, 1),
            "both_reach_pct": round(100 * c["turf_B"] / n, 1),
            "both_reach_near_line_pct": round(100 * c["both_near_line"] / c["turf_B"]) if c["turf_B"] else None,
            "verizon_fiber_pct": round(100 * c["verizon"] / n, 1),
            "no_verizon_fiber": n - c["verizon"],
            "astound_pct": round(100 * c["astound"] / n, 1),
            "one_wire_floor": c["one_wire_floor"],
            # A floor, so its share rounds down.
            "one_wire_floor_pct": math.floor(1000 * c["one_wire_floor"] / n) / 10,
            "franchise_mismatch": c["franchise_checked"] - c["franchise_match"],
            "franchise_match_pct": round(100 * c["franchise_match"] / c["franchise_checked"], 2)
                                   if c["franchise_checked"] else None,
        }

    meta = {
        "built": dt.date.today().isoformat(),
        "source_period": origin_meta["period"],
        "source": origin_meta["source"],
        "residential_only": origin_meta["residential_only"],
        "geometry": "NYC Planning 2020 Census Blocks, https://data.cityofnewyork.us/d/wmsu-5muw",
        "franchise": "OTI Cable Franchise Areas, 2016, https://data.cityofnewyork.us/d/n2h8-q6ag",
        "places": "NYC Planning 2020 Neighborhood Tabulation Areas, https://data.cityofnewyork.us/d/9nt8-h7nd",
        "city": summary(city),
        "boroughs": {k: summary(v) for k, v in sorted(boro.items())},
        "story": {"place": STORY_PLACE, **summary(story)},
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1))

    size = (OUT / "blocks.json").stat().st_size
    print(f"{len(features)} blocks, {vertices} vertices, blocks.json {size / 1e6:.2f} MB")
    print(f"franchise line {len(lines)} parts, outline {len(outline)} parts, "
          f"city.json {(OUT / 'city.json').stat().st_size / 1e3:.0f} KB")
    print(json.dumps(meta["city"]))


if __name__ == "__main__":
    main()
