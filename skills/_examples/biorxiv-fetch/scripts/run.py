#!/usr/bin/env python3
"""biorxiv-fetch — fetch a bioRxiv preprint's metadata."""
import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--doi", required=True)
    p.add_argument("--paper_dir", required=True)
    args = p.parse_args()

    paper = Path(args.paper_dir)
    safe_doi = re.sub(r"[^A-Za-z0-9._-]", "_", args.doi)
    out = paper / "outputs" / "biorxiv" / f"{safe_doi}.json"
    out.parent.mkdir(parents=True, exist_ok=True)

    url = f"https://api.biorxiv.org/pubs/{args.doi}"
    try:
        with urllib.request.urlopen(url, timeout=15) as r:
            data = json.loads(r.read().decode())
    except Exception as e:
        out.write_text(json.dumps({"doi": args.doi, "error": str(e)}))
        print(f"fetch failed: {e}")
        return 1

    out.write_text(json.dumps(data, indent=2))
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
