"""Convert NASA OSDR Inspiration4 blood panels into data/i4_blood.json.

Sources (public, de-identified crew IDs C001-C004):
  OSD-569  Complete Blood Count       LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv
  OSD-575  Comprehensive Metabolic    LSDS-8_Comprehensive_Metabolic_Panel_CMP_TRANSFORMED.csv

Usage
  # download straight from OSDR (run on a machine with normal internet access)
  python tools/osdr_i4_import.py --download

  # or point at CSVs you already downloaded from the OSDR study pages
  python tools/osdr_i4_import.py --cbc path/to/LSDS-7_...csv --cmp path/to/LSDS-8_...csv
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "i4_blood.json"

OSDR_URLS = {
    "cbc": "https://osdr.nasa.gov/geode-py/ws/studies/OSD-569/download?source=datamanager"
           "&file=LSDS-7_Complete_Blood_Count_CBC_TRANSFORMED.csv",
    "cmp": "https://osdr.nasa.gov/geode-py/ws/studies/OSD-575/download?source=datamanager"
           "&file=LSDS-8_Comprehensive_Metabolic_Panel_CMP_TRANSFORMED.csv",
}

# column prefix in the OSDR file -> (our metric id, label, unit)
CBC_METRICS = {
    "white_blood_cell_count": ("wbc", "White blood cells", "10³/µL"),
    "red_blood_cell_count": ("rbc", "Red blood cells", "10⁶/µL"),
    "hemoglobin": ("hemoglobin", "Hemoglobin", "g/dL"),   # OSDR column says percent; values are g/dL
    "hematocrit": ("hematocrit", "Hematocrit", "%"),
    "platelet_count": ("platelets", "Platelets", "10³/µL"),
    "absolute_lymphocytes": ("lymphocytes", "Lymphocytes", "cells/µL"),
    "absolute_neutrophils": ("neutrophils", "Neutrophils", "cells/µL"),
}
CMP_METRICS = {
    "glucose": ("glucose", "Glucose", "mg/dL"),
    "calcium": ("calcium", "Calcium", "mg/dL"),
    "creatinine": ("creatinine", "Creatinine", "mg/dL"),
    "urea_nitrogen_bun": ("bun", "Urea nitrogen (BUN)", "mg/dL"),
    "sodium": ("sodium", "Sodium", "mmol/L"),
    "potassium": ("potassium", "Potassium", "mmol/L"),
    "albumin": ("albumin", "Albumin", "g/dL"),
    "alt": ("alt", "ALT (liver enzyme)", "U/L"),
    "ast": ("ast", "AST (liver enzyme)", "U/L"),
    "alkaline_phosphatase": ("alk_phos", "Alkaline phosphatase", "U/L"),
}

SAMPLE_RE = re.compile(r"^(C00\d)_.*?_((?:L-|R\+)\d+)")


def _num(x: str):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def parse(text: str, metrics: dict) -> dict:
    rows = list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))
    if not rows:
        raise ValueError("empty CSV")
    cols = list(rows[0].keys())
    out: dict = {}
    for prefix, (mid, label, unit) in metrics.items():
        value_col = next((c for c in cols if c.startswith(prefix + "_value")), None)
        min_re = re.compile(rf"^{prefix}_(range_)?min")
        max_re = re.compile(rf"^{prefix}_(range_)?max")
        min_col = next((c for c in cols if min_re.match(c)), None)
        max_col = next((c for c in cols if max_re.match(c)), None)
        if not value_col:
            print(f"  warning: no value column for {prefix}", file=sys.stderr)
            continue
        for r in rows:
            m = SAMPLE_RE.match(r["Sample Name"])
            if not m:
                continue
            subj, tp = m.groups()
            v = _num(r[value_col])
            if v is None:
                continue
            entry = out.setdefault(subj, {}).setdefault(
                mid, {"label": label, "unit": unit, "range": [None, None], "points": {}})
            entry["points"][tp] = v
            lo, hi = _num(r.get(min_col)), _num(r.get(max_col))
            if lo is not None:
                entry["range"][0] = lo
            if hi is not None:
                entry["range"][1] = hi
    return out


def fetch(url: str) -> str:
    with urllib.request.urlopen(url, timeout=60) as resp:
        return resp.read().decode("utf-8")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--download", action="store_true", help="fetch the CSVs from OSDR")
    ap.add_argument("--cbc", type=Path)
    ap.add_argument("--cmp", type=Path)
    a = ap.parse_args()
    if a.download:
        cbc_text, cmp_text = fetch(OSDR_URLS["cbc"]), fetch(OSDR_URLS["cmp"])
    elif a.cbc and a.cmp:
        cbc_text = a.cbc.read_text(encoding="utf-8-sig")
        cmp_text = a.cmp.read_text(encoding="utf-8-sig")
    else:
        ap.error("use --download, or give both --cbc and --cmp")

    cbc, cmp_ = parse(cbc_text, CBC_METRICS), parse(cmp_text, CMP_METRICS)
    subjects = {}
    for subj in sorted(set(cbc) | set(cmp_)):
        subjects[subj] = {**cbc.get(subj, {}), **cmp_.get(subj, {})}
    doc = {
        "source": "NASA Open Science Data Repository: Inspiration4 OSD-569 (CBC, LSDS-7) and "
                  "OSD-575 (CMP, LSDS-8), processed TRANSFORMED files. De-identified subjects C001-C004.",
        "timepoints": ["L-92", "L-44", "L-3", "R+1", "R+45", "R+82", "R+194"],
        "note": "L = days before launch, R = days after return. The flight lasted 3 days.",
        "subjects": subjects,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    n = sum(len(m["points"]) for s in subjects.values() for m in s.values())
    print(f"wrote {OUT} ({len(subjects)} subjects, {n} values)")


if __name__ == "__main__":
    main()
