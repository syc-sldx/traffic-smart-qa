"""Import factual station/line lists from the public data used by Amap's subway viewer.

No API keys, route estimates, fares, or planned stations are included. Raw downloads
and diagnostics stay under ignored outputs/. The normalized snapshot is publishable.
"""
import concurrent.futures
import datetime
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
BASE = "https://webapi.amap.com/subway/data/"
CACHE = ROOT / "outputs" / "metro-source"
STAMP = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")


def download(url):
    request = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(request, timeout=25) as response:
        raw = response.read()
        return raw, response.headers.get("Last-Modified")


def city_name(value):
    return value.replace("特别行政区", "").removesuffix("市")


def load_network(entry):
    city = city_name(entry["cityname"])
    filename = f"{entry['adcode']}_drw_{entry['spell']}.json"
    url = BASE + filename
    try:
        raw, modified = ((CACHE / filename).read_bytes(), None) if "--from-cache" in sys.argv and (CACHE / filename).exists() else download(url)
        source = json.loads(raw)
        assert str(source["i"]) == str(entry["adcode"]), "city mismatch"
        (CACHE / filename).write_bytes(raw)
        lines = []
        excluded_stations = 0
        excluded_lines = 0
        for ordinal, line in enumerate(source["l"]):
            if str(line.get("su")) != "1":
                excluded_lines += 1
                continue
            stations = []
            for station in line.get("st", []):
                active = str(station.get("su")) == "1"
                if not active:
                    excluded_stations += 1
                aliases = list((station.get("multilang", {}).get("n") or {}).values())
                name = station["n"].strip()
                assert name and "\ufffd" not in name, "invalid station name"
                coordinate = station.get("sl", "").split(",")
                stations.append({
                    "id": str(station.get("poiid") or station.get("si") or station.get("sid")),
                    "source_station_id": str(station.get("si") or station.get("sid")),
                    "name": name,
                    "aliases": list(dict.fromkeys(a for a in aliases if isinstance(a, str) and a)),
                    "active": active,
                    "location": [float(x) for x in coordinate] if len(coordinate) == 2 else None,
                })
            if sum(s["active"] for s in stations) < 2:
                continue
            lines.append({
                "id": str(line["ls"]) + ":" + str(ordinal),
                "service_id": str(line["ls"]),
                "name": line["ln"],
                "color": "#" + line.get("cl", "2864ec"),
                "loop": str(line.get("lo")) == "1",
                "stations": stations,
            })
        assert lines, "no operating lines"
        return {"city": city, "adcode": entry["adcode"], "slug": entry["spell"],
                "map_url": "https://m.amap.com/service/subway/" + entry["spell"] + "/",
                "data_url": url, "retrieved_at": STAMP, "source_last_modified": modified,
                "source_sha256": hashlib.sha256(raw).hexdigest(), "lines": lines,
                "excluded_lines": excluded_lines, "excluded_station_occurrences": excluded_stations}
    except Exception as error:
        return {"city": city, "error": str(error), "data_url": url}


def main():
    global STAMP
    CACHE.mkdir(parents=True, exist_ok=True)
    if "--from-cache" in sys.argv and (ROOT / "server/metro-data.json").exists():
        STAMP = json.loads((ROOT / "server/metro-data.json").read_text(encoding="utf-8"))["retrieved_at"]
    snapshot = json.loads((ROOT / "server/snapshot.json").read_text(encoding="utf-8"))
    annual = json.loads((ROOT / "server/annual-data.json").read_text(encoding="utf-8"))
    scope = sorted({r["city"] for rows in snapshot.values() for r in rows} | set(annual["summary"]["cities"]))
    raw = (CACHE / "citylist.json").read_bytes() if "--from-cache" in sys.argv else download(BASE + "citylist.json")[0]
    (CACHE / "citylist.json").write_bytes(raw)
    catalogue = json.loads(raw)["citylist"]
    wanted = [entry for entry in catalogue if city_name(entry["cityname"]) in scope]
    networks, failures = [], []
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        for index, network in enumerate(pool.map(load_network, wanted), 1):
            (failures if "error" in network else networks).append(network)
            if index % 5 == 0 or index == len(wanted):
                print(json.dumps({"downloaded": index, "total": len(wanted), "failed": len(failures)}), flush=True)
    networks.sort(key=lambda n: n["city"])
    available = {n["city"]: n for n in networks}
    failure_names = {n["city"] for n in failures}
    coverage = [{"city": name, "status": "available" if name in available else "download_failed" if name in failure_names else "not_in_provider_catalogue"} for name in scope]
    count = sum(len({s["id"] for line in n["lines"] for s in line["stations"] if s["active"]}) for n in networks)
    result = {"schema_version": 1, "retrieved_at": STAMP,
              "source": {"title": "高德公开地铁线网", "catalogue_url": BASE + "citylist.json", "viewer_url": "https://m.amap.com/subway/"},
              "scope_cities": scope, "coverage": coverage, "networks": networks,
              "summary": {"scope_cities": len(scope), "network_cities": len(networks),
                          "line_variants": sum(len(n["lines"]) for n in networks),
                          "stations": count, "failed_downloads": len(failures)},
              "limitations": "抓取日期不等于供应商最后更新日期；未在目录收录不代表当地没有轨道交通。只采用供应商标记运营的线路和站点；不含实时停运、班次、票价与末班车保证。"}
    target = ROOT / "server/metro-data.json"
    target.write_text(json.dumps(result, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    from build_metro_maps import main as build_maps
    build_maps()
    (CACHE / "import-report.json").write_text(json.dumps({"summary": result["summary"], "failures": failures, "coverage": coverage}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"summary": result["summary"], "failures": failures}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    main()
