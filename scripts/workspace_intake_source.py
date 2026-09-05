#!/usr/bin/env python3
"""Bounded bridge to the pinned Workspace Governance source authority."""
import argparse
import json
from pathlib import Path
import sys

parser = argparse.ArgumentParser()
parser.add_argument("command", choices=("prepare", "readback"))
parser.add_argument("--source-root", type=Path, required=True)
parser.add_argument("--input", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.source_root / "scripts"))
from workspace_intake import apply_intake, bind_artifact_digest, canonical_digest, load_yaml

value = json.loads(args.input.read_text())
if args.command == "prepare":
    result = apply_intake(
        repo_root=args.source_root,
        request=value["request"], decision=value["decision"],
        output_dir=args.output.parent / "owner-evidence",
        source_branch=value["branch"], completed_at=value["at"],
    )
    result["register_text"] = (args.source_root / "contracts/intake-register.yaml").read_text()
else:
    register = load_yaml(args.source_root / "contracts/intake-register.yaml")
    target = value["readback"]["target"]
    collection = {"repo": "repos", "product": "products", "component": "components"}[target["kind"]]
    record = register[collection][target["name"]]
    result = bind_artifact_digest({
        **value["readback"],
        "authority_state": "merged-authority", "source_branch": "main",
        "readback_id": "intake-merged-readback:" + canonical_digest({"commit": value["commit"], "record": record})[7:],
        "observed_at": value["at"], "record": record,
        "record_digest": canonical_digest(record), "register_digest": canonical_digest(register),
    })
args.output.write_text(json.dumps(result, ensure_ascii=False))
