#!/usr/bin/env python3
"""Market data fetcher — writes data.js (+ data.json) for the dashboard.

Stdlib only. Sources: Yahoo Finance chart API (indices, FX, futures, crypto,
US 10Y) and the ECB data portal (euro-area 10Y AAA yield). Each run rewrites
the full 2y daily history including today's in-progress session, atomically,
so index.html always finds a complete file. A series that fails to fetch keeps
its previous data from data.json.
"""

import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

BASE = os.path.dirname(os.path.abspath(__file__))
DATA_JSON = os.path.join(BASE, "data.json")
DATA_JS = os.path.join(BASE, "data.js")
LOG = os.path.join(BASE, "fetch.log")

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

# Deep fetch = full history, once a day. Shallow fetch = last month, merged
# into stored history — keeps the 15-min cadence cheap.
DEEP_YEARS = 15
YAHOO_DEEP = ("https://query1.finance.yahoo.com/v8/finance/chart/{sym}"
              "?period1={p1}&period2={p2}&interval=1d")
YAHOO_SHALLOW = "https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1mo&interval=1d"
ECB = ("https://data-api.ecb.europa.eu/service/data/YC/"
       "B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?format=csvdata&lastNObservations={n}")

# Monthly/quarterly series: skipped on shallow runs (they cannot change intraday).
MONTHLY = {"eps", "pe", "cape", "divyield", "hpi", "hpi_ca", "hpi_de", "hpi_au", "hpi_uk"}

# key -> (display name, unit, decimals, source, source symbol)
SERIES = {
    "spx":    ("S&P 500",             "",  0, "yahoo", "^GSPC"),
    "ndx":    ("NASDAQ 100",          "",  0, "yahoo", "^NDX"),
    "sx5e":   ("EURO STOXX 50",       "",  0, "yahoo", "^STOXX50E"),
    "dax":    ("DAX",                 "",  0, "yahoo", "^GDAXI"),
    "n225":   ("Nikkei 225",          "",  0, "yahoo", "^N225"),
    "eurusd": ("EUR/USD",             "",  4, "yahoo", "EURUSD=X"),
    "gbpusd": ("GBP/USD",             "",  4, "yahoo", "GBPUSD=X"),
    "usdjpy": ("USD/JPY",             "",  2, "yahoo", "JPY=X"),
    "us10y":  ("US 10Y yield",        "%", 3, "yahoo", "^TNX"),
    "eu10y":  ("Euro 10Y yield (AAA)", "%", 3, "ecb",  ""),
    "gold":   ("Gold",                "$", 1, "yahoo", "GC=F"),
    "brent":  ("Brent crude",         "$", 2, "yahoo", "BZ=F"),
    "btc":    ("Bitcoin",             "$", 0, "yahoo", "BTC-USD"),
    "eth":    ("Ethereum",            "$", 0, "yahoo", "ETH-USD"),
    # inputs for the ratio panels
    "tlt":    ("TLT (20Y+ treasuries)", "$", 2, "yahoo", "TLT"),
    "veu":    ("VEU (world ex-US)",   "$", 2, "yahoo", "VEU"),
    "copper": ("Copper",              "$", 4, "yahoo", "HG=F"),
    # monthly valuation series (multpl.com, ttm; recent months are estimates)
    "eps":    ("S&P 500 EPS (ttm)",   "$", 2, "multpl", "s-p-500-earnings"),
    "pe":     ("S&P 500 P/E (ttm)",   "",  2, "multpl", "s-p-500-pe-ratio"),
    "cape":   ("Shiller CAPE",        "",  2, "multpl", "shiller-pe"),
    "divyield": ("S&P 500 dividend yield", "%", 2, "multpl", "s-p-500-dividend-yield"),
    "mxnjpy": ("MXN/JPY (carry trade)", "", 3, "yahoo", "MXNJPY=X"),
    # FRED symbol format: "SERIES_ID:years_to_keep"
    "us2y":   ("US 2Y yield",         "%", 3, "fred", "DGS2:15"),
    "us30y":  ("US 30Y yield",        "%", 3, "fred", "DGS30:15"),
    # FHFA purchase-only HPI (US-government work, public domain) — deliberately
    # NOT Case-Shiller, which FRED marks "Copyrighted: Pre-Approval Required".
    "hpi":    ("US (FHFA)",           "", 1, "fred", "HPIPONM226S:30"),
    # BIS nominal residential property prices, quarterly (2010 = 100)
    "hpi_ca": ("Canada",              "", 1, "fred", "QCAN628BIS:30"),
    "hpi_de": ("Germany",             "", 1, "fred", "QDEN628BIS:30"),
    "hpi_au": ("Australia",           "", 1, "fred", "QAUN628BIS:30"),
    "hpi_uk": ("United Kingdom",      "", 1, "fred", "QGBN628BIS:30"),
    # BIS daily central bank policy rates (WS_CBPOL)
    "pol_us": ("US (Fed)",            "%", 3, "bis", "US"),
    "pol_xm": ("Euro area (ECB)",     "%", 3, "bis", "XM"),
    "pol_gb": ("UK (BoE)",            "%", 3, "bis", "GB"),
    "pol_jp": ("Japan (BoJ)",         "%", 3, "bis", "JP"),
    "pol_ch": ("Switzerland (SNB)",   "%", 3, "bis", "CH"),
    "pol_ca": ("Canada (BoC)",        "%", 3, "bis", "CA"),
    "pol_au": ("Australia (RBA)",     "%", 3, "bis", "AU"),
}

BIS_POL = ("https://stats.bis.org/api/v1/data/BIS,WS_CBPOL,1.0/D.{area}/all"
           "?format=csv&detail=dataonly&lastNObservations={n}")


def fetch_bis(area, decimals, deep):
    import csv, io
    text = get(BIS_POL.format(area=area, n=int(DEEP_YEARS * 366) if deep else 40),
               timeout=60 if deep else 20)
    rows = list(csv.reader(io.StringIO(text)))
    i_d, i_v = rows[0].index("TIME_PERIOD"), rows[0].index("OBS_VALUE")
    points = []
    for r in rows[1:]:
        try:
            d = datetime.strptime(r[i_d], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            v = float(r[i_v])
            if v != v or v in (float("inf"), float("-inf")):
                continue  # BIS emits literal "NaN" for undefined days
            points.append([int(d.timestamp() * 1000), round(v, decimals)])
        except (ValueError, IndexError):
            continue
    points.sort()
    if len(points) < 2:
        raise ValueError("too few points from BIS %s" % area)
    return points

FRED = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}&cosd={start}"


def fetch_fred(sym, decimals, deep):
    sid, years = sym.split(":")
    if not deep:
        years = 0.1  # ~5 weeks; merged into stored history
    cutoff_s = datetime.now(timezone.utc).timestamp() - float(years) * 365.25 * 86400
    start = datetime.fromtimestamp(cutoff_s, timezone.utc).strftime("%Y-%m-%d")
    lines = get(FRED.format(sid=sid, start=start), timeout=45, ua=None).splitlines()
    cutoff = cutoff_s * 1000
    points = []
    for line in lines[1:]:
        try:
            date_str, val = line.split(",")
            d = datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            t = int(d.timestamp() * 1000)
            if t >= cutoff:
                points.append([t, round(float(val), decimals)])
        except ValueError:
            continue  # header or "." missing-value rows
    if len(points) < 2:
        raise ValueError("too few points from FRED %s" % sid)
    return points

MULTPL = "https://www.multpl.com/{slug}/table/by-month"
MULTPL_YEARS = 30  # keep the tail; full history goes back to 1871


def fetch_multpl(slug, decimals):
    import re
    html = get(MULTPL.format(slug=slug))
    table = re.search(r'id="datatable"(.*?)</table>', html, re.S)
    rows = re.findall(r'<tr[^>]*>\s*<td>([^<]+)</td>\s*<td[^>]*>(.*?)</td>', table.group(1), re.S)
    points = []
    for date_str, cell in rows:
        cell = re.sub(r"&#?[0-9A-Za-z]+;", " ", re.sub(r"<[^>]*>", " ", cell))
        num = re.search(r"[0-9][0-9,]*\.?[0-9]*", cell)
        if not num:
            continue
        d = datetime.strptime(date_str.strip(), "%b %d, %Y").replace(tzinfo=timezone.utc)
        points.append([int(d.timestamp() * 1000), round(float(num.group().replace(",", "")), decimals)])
    points.sort()
    cutoff = (datetime.now(timezone.utc).timestamp() - MULTPL_YEARS * 365.25 * 86400) * 1000
    points = [p for p in points if p[0] >= cutoff]
    if len(points) < 2:
        raise ValueError("too few points from multpl %s" % slug)
    return points


def get(url, timeout=20, ua=UA):
    # ua=None sends urllib's default agent — FRED rejects browser-like UAs
    # from non-browser clients but accepts plain ones.
    req = urllib.request.Request(url, headers={"User-Agent": ua} if ua else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def fetch_yahoo(sym, decimals, deep):
    if deep:
        now = int(time.time())
        url = YAHOO_DEEP.format(sym=urllib.parse.quote(sym),
                                p1=now - int(DEEP_YEARS * 365.25 * 86400), p2=now + 86400)
    else:
        url = YAHOO_SHALLOW.format(sym=urllib.parse.quote(sym))
    raw = json.loads(get(url, timeout=45 if deep else 20))
    result = raw["chart"]["result"][0]
    ts = result["timestamp"]
    close = result["indicators"]["quote"][0]["close"]
    points = [[t * 1000, round(c, decimals)]
              for t, c in zip(ts, close) if c is not None]
    if len(points) < 2:
        raise ValueError("too few points for %s" % sym)
    return points


def fetch_ecb(decimals, deep):
    lines = get(ECB.format(n=DEEP_YEARS * 261 if deep else 12), timeout=45 if deep else 20).splitlines()
    header = lines[0].split(",")
    i_date = header.index("TIME_PERIOD")
    i_val = header.index("OBS_VALUE")
    points = []
    for line in lines[1:]:
        # OBS_COM contains commas but sits after the fields we need only if
        # quoted fields precede them — they don't: TIME_PERIOD/OBS_VALUE are
        # early, unquoted columns, so a naive split is safe for them.
        cols = line.split(",")
        try:
            d = datetime.strptime(cols[i_date], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            points.append([int(d.timestamp() * 1000), round(float(cols[i_val]), decimals)])
        except (ValueError, IndexError):
            continue
    if len(points) < 2:
        raise ValueError("too few points from ECB")
    points.sort()
    return points


def source_label(source, sym):
    if source == "yahoo":
        return "Yahoo Finance (unofficial API; end-of-day/delayed)"
    if source == "ecb":
        return "European Central Bank"
    if source == "multpl":
        return "multpl.com (Robert Shiller / S&P data)"
    if source == "bis":
        return "Bank for International Settlements (central bank policy rates)"
    if source == "fred":
        sid = sym.split(":")[0]
        if sid.startswith("DGS"):
            return "Board of Governors (H.15), via FRED"
        if sid.startswith("HPIPON"):
            return "FHFA, via FRED"
        if sid.endswith("628BIS"):
            return "Bank for International Settlements, via FRED"
        return "FRED, Federal Reserve Bank of St. Louis"
    return source


def load_previous():
    try:
        with open(DATA_JSON) as f:
            prev = json.load(f)
        return prev if not prev.get("sample") else {}
    except (OSError, ValueError):
        return {}


def merge(prev_points, new_points):
    """Splice a shallow fetch onto stored history: keep everything older than
    the new window, then the new points."""
    if not prev_points:
        return new_points
    head = [p for p in prev_points if p[0] < new_points[0][0]]
    return head + new_points


def main():
    # Single-instance lock: a slow run (source timeouts) must not overlap the
    # next scheduled run and clobber its output with stale inputs.
    import fcntl
    lock = open(os.path.join(BASE, ".fetch.lock"), "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log("SKIP: another fetch is still running")
        return

    series, failures = {}, []
    prev_payload = load_previous()
    prev_series = prev_payload.get("series", {})
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    # Deep-fetch full history once a day; otherwise fetch the last month and
    # splice it onto stored history. A series added to SERIES but absent from
    # the stored file also forces a deep run, as does --deep.
    deep = (prev_payload.get("deep_date") != today
            or "--deep" in sys.argv
            or any(k not in prev_payload.get("series", {}) for k in SERIES))

    for key, (name, unit, decimals, source, sym) in SERIES.items():
        if not deep and key in MONTHLY:
            continue  # monthly data can't change intraday; backfilled below
        points = None
        for attempt in (1, 2):
            try:
                if source == "ecb":
                    points = fetch_ecb(decimals, deep)
                elif source == "multpl":
                    points = fetch_multpl(sym, decimals)
                elif source == "fred":
                    points = fetch_fred(sym, decimals, deep)
                elif source == "bis":
                    points = fetch_bis(sym, decimals, deep)
                else:
                    points = fetch_yahoo(sym, decimals, deep)
                break
            except Exception as e:
                if attempt == 2:
                    failures.append("%s (%s)" % (key, e))
                else:
                    time.sleep(2)
        if points is None:
            continue  # backfilled from the previous file below, if possible
        if not deep and key in prev_series:
            points = merge(prev_series[key]["points"], points)
        series[key] = {"name": name, "unit": unit, "decimals": decimals,
                       "src": source_label(source, sym), "points": points}
        time.sleep(0.4)  # be polite to the APIs

    if not series:
        log("FAIL: no data fetched, keeping existing files")
        sys.exit(1)

    # Backfill failed/skipped series from the previous file, read NOW (not at
    # start), so a concurrent or recent successful run's data is never lost.
    previous = load_previous().get("series", {})
    kept = [k for k in SERIES if k not in series and k in previous]
    for k in kept:
        series[k] = previous[k]

    # Refuse to publish a gutted dataset (e.g. CI runner rate-limited by
    # Yahoo): with no previous file to backfill from, better to fail the run
    # and keep the last deployed version than to ship a near-empty page.
    if len(series) < 15:
        log("FAIL: only %d/%d series available, not writing" % (len(series), len(SERIES)))
        sys.exit(1)

    # A failed deep run must retry deep next time, or history stays shallow.
    deep_ok = deep and not failures
    payload = {
        "updated": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "deep_date": today if deep_ok else prev_payload.get("deep_date"),
        "sample": False,
        "series": series,
    }

    blob = json.dumps(payload, separators=(",", ":"))
    for path, content in ((DATA_JSON, blob), (DATA_JS, "window.FIN_DATA = %s;\n" % blob)):
        tmp = path + ".tmp"
        with open(tmp, "w") as f:
            f.write(content)
        os.replace(tmp, path)

    log("OK: %d series%s" % (len(series),
        ("; stale/failed: " + ", ".join(failures)) if failures else ""))


def log(msg):
    line = "%s %s\n" % (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), msg)
    try:
        # keep the log from growing forever
        if os.path.exists(LOG) and os.path.getsize(LOG) > 200_000:
            with open(LOG) as f:
                tail = f.readlines()[-500:]
            with open(LOG, "w") as f:
                f.writelines(tail)
        with open(LOG, "a") as f:
            f.write(line)
    except OSError:
        pass
    print(line, end="")


if __name__ == "__main__":
    main()
