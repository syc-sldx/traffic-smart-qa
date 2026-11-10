"""Preserve schematic geometry from the same public snapshot as the station index."""
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def point(value):
    values = [float(v) for v in value.replace(",", " ").split()]
    assert len(values) == 2 and all(math.isfinite(v) for v in values)
    return [round(v, 1) for v in values]


def simplify(points, tolerance=0.8):
    if len(points) < 3:
        return points
    a, b = points[0], points[-1]
    dx, dy = b[0] - a[0], b[1] - a[1]
    length = dx * dx + dy * dy
    distances = []
    for p in points[1:-1]:
        t = max(0, min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) if length else 0
        distances.append((p[0] - a[0] - t * dx) ** 2 + (p[1] - a[1] - t * dy) ** 2)
    greatest = max(distances)
    if greatest <= tolerance * tolerance:
        return [a, b]
    split = distances.index(greatest) + 1
    return simplify(points[:split + 1], tolerance)[:-1] + simplify(points[split:], tolerance)


def main():
    dataset = json.loads((ROOT / "server/metro-data.json").read_text(encoding="utf-8"))
    maps = []
    for network in dataset["networks"]:
        source = json.loads((ROOT / f"outputs/metro-source/{network['adcode']}_drw_{network['slug']}.json").read_text(encoding="utf-8"))
        raw_lines = {str(line["ls"]) + ":" + str(i): line for i, line in enumerate(source["l"])}
        lines = []
        for line in network["lines"]:
            raw = raw_lines[line["id"]]
            stations = []
            paths, segment = [], []
            for station in raw["st"]:
                if str(station.get("su")) != "1":
                    if len(segment) > 1:
                        paths.append(segment)
                    segment = []
                    continue
                position = point(station["p"])
                segment.append(position)
                stations.append([str(station.get("poiid") or station.get("si") or station.get("sid")), *position, int(station.get("lg", 2))])
            if len(segment) > 1:
                paths.append(segment)
            # Full source polylines preserve bends. Partial lines stop at inactive
            # stations instead of bridging closed / unfinished portions.
            if all(s["active"] for s in line["stations"]):
                polyline = simplify([point(p) for p in raw.get("c", [])])
                if len(polyline) > 1:
                    paths = [polyline]
                if line["loop"] and paths and paths[0][0] != paths[0][-1]:
                    paths[0].append(paths[0][0])
            assert stations and paths, network["city"] + line["name"]
            lines.append({"id": line["id"], "paths": paths, "stations": stations})
        maps.append({"city": network["city"], "lines": lines})
    result = {"retrieved_at": dataset["retrieved_at"], "maps": maps}
    target = ROOT / "server/metro-map-data.json"
    target.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(json.dumps({"maps": len(maps), "bytes": target.stat().st_size}))


if __name__ == "__main__":
    main()
