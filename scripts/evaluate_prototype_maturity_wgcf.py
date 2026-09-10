#!/usr/bin/env python3
"""Evaluate one Prototype Maturity envelope through an exact WGCF checkout."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wgcf-root", required=True, type=Path)
    parser.add_argument("--authority-root", required=True, type=Path)
    return parser.parse_args()


def git_revision(root: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(root), "rev-parse", "refs/remotes/origin/main"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def assert_exact_checkout(root: Path) -> str:
    revision = git_revision(root)
    head = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    status = subprocess.run(
        ["git", "-C", str(root), "status", "--porcelain"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if head != revision or status:
        raise RuntimeError(
            "WGCF conformance requires a clean exact origin/main checkout"
        )
    return revision


def main() -> None:
    args = parse_args()
    wgcf_root = args.wgcf_root.resolve()
    authority_root = args.authority_root.resolve()
    sys.path.insert(0, str(wgcf_root / "packages/control_fabric_core/src"))

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool

    from control_fabric_core.db.models import Base
    from control_fabric_core.prototype_maturity_contracts import (
        PrototypeMaturityAuthority,
        PrototypeMaturityContracts,
        canonical_bytes,
    )
    from control_fabric_core.prototype_maturity_readiness import (
        PrototypeMaturityReadinessService,
    )

    envelope = json.load(sys.stdin)
    requested_at = envelope["request"]["requested_at"].replace("Z", "+00:00")
    clock_value = datetime.fromisoformat(requested_at).astimezone(timezone.utc)
    implementation_ref = assert_exact_checkout(wgcf_root)

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    contracts = PrototypeMaturityContracts.load(
        wgcf_root / "contracts/prototype-maturity"
    )
    service = PrototypeMaturityReadinessService(
        session_factory=sessions,
        authority=PrototypeMaturityAuthority(authority_root, contracts),
        service_identity_ref=(
            "service-identity://workspace-governance-control-fabric/dev-integration"
        ),
        implementation_ref=implementation_ref,
        clock=lambda: clock_value,
    )

    raw = canonical_bytes(envelope)
    issued = service.issue(raw, actor="governance-operations-console")
    reused = service.issue(raw, actor="governance-operations-console")
    token = issued["readiness"]["readiness_digest"].removeprefix("sha256:")
    readback = service.read(token, actor="governance-operations-console")
    if reused["ledger"]["resolution"] != "reused":
        raise RuntimeError("WGCF maturity readiness replay was not idempotent")
    if readback["ledger"]["resolution"] != "read":
        raise RuntimeError("WGCF maturity readiness readback was not durable")
    if not (
        issued["readiness"] == reused["readiness"] == readback["readiness"]
    ):
        raise RuntimeError(
            "WGCF maturity readiness changed across issue, replay, or readback"
        )

    json.dump(
        {
            "result": issued,
            "proof": {
                "authority_revision": git_revision(authority_root),
                "implementation_ref": implementation_ref,
                "issue_resolution": issued["ledger"]["resolution"],
                "replay_resolution": reused["ledger"]["resolution"],
                "readback_resolution": readback["ledger"]["resolution"],
            },
        },
        sys.stdout,
        sort_keys=True,
        separators=(",", ":"),
    )


if __name__ == "__main__":
    main()
