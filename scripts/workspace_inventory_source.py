#!/usr/bin/env python3
"""Bounded bridge to the pinned Workspace Governance inventory authority."""

import argparse
import copy
import json
from pathlib import Path
import sys


parser = argparse.ArgumentParser()
parser.add_argument("command", choices=("prepare", "readback", "registry", "state"))
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
    WorkspaceInventoryError,
    _validate_contract,
    apply_promotion,
    bind_artifact_digest,
    current_state,
)


def unique_text(values):
    return list(dict.fromkeys(value for value in values if isinstance(value, str) and value))


def owner_refs(kind, name, entry):
    if kind == "repo":
        return unique_text([name, entry.get("security_owner")])
    if kind == "product":
        return unique_text(
            [
                entry.get("platform_owner"),
                entry.get("security_owner"),
                entry.get("runtime_owner"),
                *(entry.get("source_owners") or []),
            ]
        )
    return unique_text(
        [entry.get("owner_repo"), entry.get("security_owner"), entry.get("product")]
    )


def active_value(kind, entry):
    validation = copy.deepcopy(entry.get("validation_behavior"))
    if not isinstance(validation, dict):
        return None
    if kind == "repo":
        repo_class = entry.get("repo_class")
        bindings = entry.get("requires_security_bindings")
        if not isinstance(repo_class, str) or not repo_class or not isinstance(bindings, bool):
            return None
        return {
            "posture": "active",
            "lifecycle": "active",
            "repo_class": repo_class,
            "requires_security_bindings": bindings,
            "owns": [],
            "must_not_own": [],
            "allowed_authoritative_refs": [],
            "validation_behavior": validation,
        }
    if kind == "product":
        required = [
            entry.get("platform_owner"),
            entry.get("security_owner"),
            entry.get("runtime_owner"),
        ]
        sources = entry.get("source_owners")
        if not all(isinstance(value, str) and value for value in required):
            return None
        if not isinstance(sources, list) or not sources or not all(isinstance(value, str) and value for value in sources):
            return None
        return {
            "posture": "active",
            "maturity": "owner-managed",
            "lifecycle": "owner-managed",
            "platform_owner": entry["platform_owner"],
            "security_owner": entry["security_owner"],
            "runtime_owner": entry["runtime_owner"],
            "source_owners": copy.deepcopy(sources),
            "stage_supported": False,
            "governed_prod_promotion": False,
            "highest_real_endpoint": "owner-managed-source",
            "validation_behavior": validation,
        }
    required = [entry.get("component_class"), entry.get("owner_repo"), entry.get("security_owner")]
    if not all(isinstance(value, str) and value for value in required):
        return None
    product = entry.get("product")
    if product is not None and (not isinstance(product, str) or not product):
        return None
    return {
        "posture": "active",
        "lifecycle": "active",
        "component_class": entry["component_class"],
        "owner_repo": entry["owner_repo"],
        "product": product,
        "security_owner": entry["security_owner"],
        "validation_behavior": validation,
    }


def projection_record(kind, name, entry):
    envelope = entry["record"]
    lineage = envelope["lineage"]
    mutation = envelope["last_mutation"]
    return {
        "id": envelope["id"],
        "kind": kind,
        "name": name,
        "version": envelope["version"],
        "posture": entry["posture"],
        "maturity": entry.get("maturity") if kind == "product" else None,
        "owner_refs": owner_refs(kind, name, entry),
        "lineage": {
            "source": lineage["source"],
            "source_ref": lineage["source_ref"],
            "source_digest": lineage["source_digest"],
            "intake_entry_version": lineage.get("intake_entry_version"),
        },
        "last_mutation": {
            "id": mutation["id"],
            "action": mutation["action"],
            "applied_at": mutation["applied_at"],
            "request_ref": mutation.get("request_ref"),
            "readiness_ref": mutation.get("readiness_ref"),
        },
        "record_digest": canonical_digest(entry),
    }


def candidate_valid(repo_root, kind, name, value, intake_entry, inventory):
    test_inventory = copy.deepcopy(inventory)
    test_inventory[COLLECTIONS[kind]][name] = {
        **copy.deepcopy(value),
        "record": {
            "id": f"{kind}:{name}",
            "version": 1,
            "lineage": {
                "source": "workspace-intake",
                "source_ref": intake_entry["record"]["id"],
                "source_digest": canonical_digest(intake_entry),
                "intake_entry_version": intake_entry["record"]["version"],
            },
            "last_mutation": {
                "id": f"workspace-inventory-mutation:registry-proof:{kind}:{name}",
                "action": "promote",
                "idempotency_key": f"registry-proof:{kind}:{name}",
                "request_ref": f"workspace-inventory-request:registry-proof:{kind}:{name}",
                "request_digest": "sha256:" + "0" * 64,
                "readiness_ref": f"workspace-inventory-readiness:registry-proof:{kind}:{name}",
                "readiness_digest": "sha256:" + "1" * 64,
                "applied_at": "2000-01-01T00:00:00Z",
            },
        },
    }
    try:
        _validate_contract(repo_root, f"{COLLECTIONS[kind]}.yaml", test_inventory)
    except WorkspaceInventoryError:
        return False
    return True


def registry_projection(repo_root):
    intake = load_yaml(repo_root / "contracts" / "intake-register.yaml")
    _validate_contract(repo_root, "intake-register.yaml", intake)
    inventories = {
        kind: load_yaml(repo_root / INVENTORY_FILES[kind]) for kind in COLLECTIONS
    }
    for kind, collection in COLLECTIONS.items():
        _validate_contract(repo_root, f"{collection}.yaml", inventories[kind])

    records = []
    for kind, collection in COLLECTIONS.items():
        for name, entry in inventories[kind][collection].items():
            records.append(projection_record(kind, name, entry))
        if kind == "repo":
            for name, entry in inventories[kind].get("retired_repos", {}).items():
                records.append(projection_record(kind, name, entry))

    candidates = []
    active_ids = {record["id"] for record in records}
    for kind, collection in COLLECTIONS.items():
        for name, entry in intake.get(collection, {}).items():
            record_id = f"{kind}:{name}"
            if entry.get("status") != "admitted" or record_id in active_ids:
                continue
            value = active_value(kind, entry)
            if value is None or not candidate_valid(repo_root, kind, name, value, entry, inventories[kind]):
                continue
            candidate = {
                "target": {"kind": kind, "name": name, "record_id": record_id},
                "intake_entry_ref": {
                    "id": entry["record"]["id"],
                    "version": entry["record"]["version"],
                    "digest": canonical_digest(entry),
                },
                "active_record": {"kind": kind, "id": record_id, "value": value},
                "owner_refs": owner_refs(kind, name, entry),
                "approval_refs": unique_text(
                    [entry["record"]["decision"]["ref"], entry["record"]["decision"]["id"]]
                ),
            }
            candidate["candidate_digest"] = canonical_digest(candidate)
            candidates.append(candidate)

    return {
        "records": sorted(records, key=lambda item: (item["kind"], item["name"])),
        "eligible_promotions": sorted(
            candidates, key=lambda item: (item["target"]["kind"], item["target"]["name"])
        ),
    }


value = json.loads(args.input.read_text())
if args.command == "state":
    target = value["target"]
    result = current_state(args.source_root, target["kind"], target["name"])
elif args.command == "registry":
    result = registry_projection(args.source_root)
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
