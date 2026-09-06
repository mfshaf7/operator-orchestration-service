#!/usr/bin/env python3
"""Bounded bridge to the pinned Workspace Governance inventory authority."""

import argparse
import json
from pathlib import Path
import sys


parser = argparse.ArgumentParser()
parser.add_argument("command", choices=("prepare", "readback", "state"))
parser.add_argument("--source-root", type=Path, required=True)
parser.add_argument("--input", type=Path, required=True)
parser.add_argument("--output", type=Path, required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.source_root / "scripts"))

from contracts_lib import load_yaml  # noqa: E402
from workspace_intake import canonical_digest  # noqa: E402
from workspace_inventory import (  # noqa: E402
    COLLECTIONS,
    INVENTORY_FILES,
    apply_promotion,
    bind_artifact_digest,
    current_state,
)


value = json.loads(args.input.read_text())
if args.command == "state":
    target = value["target"]
    result = current_state(args.source_root, target["kind"], target["name"])
elif args.command == "prepare":
    result = apply_promotion(
        repo_root=args.source_root,
        request=value["request"],
        readiness=value["readiness"],
        output_dir=args.output.parent / "owner-evidence",
        source_branch=value["branch"],
        completed_at=value["at"],
    )
    kind = value["request"]["target"]["kind"]
    result["intake_text"] = (
        args.source_root / "contracts" / "intake-register.yaml"
    ).read_text()
    result["inventory_path"] = INVENTORY_FILES[kind]
    result["inventory_text"] = (args.source_root / INVENTORY_FILES[kind]).read_text()
else:
    target = value["readback"]["target"]
    collection = COLLECTIONS[target["kind"]]
    intake = load_yaml(args.source_root / "contracts" / "intake-register.yaml")
    inventory = load_yaml(args.source_root / INVENTORY_FILES[target["kind"]])
    active_record = inventory[collection][target["name"]]
    result = bind_artifact_digest(
        {
            **value["readback"],
            "authority_state": "merged-authority",
            "source_branch": "main",
            "readback_id": "workspace-inventory-merged-readback:"
            + canonical_digest(
                {"commit": value["commit"], "active_record": active_record}
            )[7:],
            "observed_at": value["at"],
            "intake_register_digest": canonical_digest(intake),
            "active_inventory_digest": canonical_digest(inventory),
            "intake_entry_present": target["name"] in intake[collection],
            "active_record": active_record,
        }
    )
args.output.write_text(json.dumps(result, ensure_ascii=False))
