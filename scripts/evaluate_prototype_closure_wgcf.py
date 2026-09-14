#!/usr/bin/env python3
"""Evaluate one Closure request against exact Studio and WGCF source clones."""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys


def revision(root: Path) -> str:
    return subprocess.run(
        ["git", "-C", str(root), "rev-parse", "refs/remotes/origin/main"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--wgcf-root", required=True, type=Path)
    parser.add_argument("--studio-root", required=True, type=Path)
    args = parser.parse_args()
    wgcf_root = args.wgcf_root.resolve()
    studio_root = args.studio_root.resolve()
    if subprocess.run(
        ["git", "-C", str(wgcf_root), "status", "--porcelain"],
        check=True, capture_output=True, text=True,
    ).stdout.strip():
        raise RuntimeError("WGCF conformance clone must be clean")
    if subprocess.run(
        ["git", "-C", str(wgcf_root), "rev-parse", "HEAD"],
        check=True, capture_output=True, text=True,
    ).stdout.strip() != revision(wgcf_root):
        raise RuntimeError("WGCF conformance clone must be at origin/main")
    sys.path.insert(0, str(wgcf_root / "packages/control_fabric_core/src"))

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from sqlalchemy.pool import StaticPool
    from control_fabric_core.db.models import Base
    from control_fabric_core.prototype_closure_authority import PrototypeClosureAuthority
    from control_fabric_core.prototype_closure_policy import VerifiedReference
    from control_fabric_core.prototype_closure_readiness import PrototypeClosureReadinessService
    from control_fabric_core.prototype_maturity_contracts import canonical_bytes

    payload = json.load(sys.stdin)
    evaluation = payload["evaluation"]
    fixture = payload["owner_evidence"]

    class FixtureOwnerReader:
        def resolve(self, request, source):
            return {
                field: VerifiedReference(**row)
                for field, row in fixture.items()
            }

    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False}, poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    sessions = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    at = datetime.fromisoformat(payload["at"].replace("Z", "+00:00")).astimezone(timezone.utc)
    service = PrototypeClosureReadinessService(
        session_factory=sessions,
        authority=PrototypeClosureAuthority(studio_root),
        evidence_resolver=FixtureOwnerReader(),
        service_identity_ref="service-identity://workspace-governance-control-fabric/conformance",
        implementation_ref=revision(wgcf_root),
        clock=lambda: at,
    )
    raw = canonical_bytes(evaluation)
    issued = service.issue(raw, actor="operator-orchestration-service")
    replayed = service.issue(raw, actor="operator-orchestration-service")
    read = service.read(
        issued["readiness"]["readiness_digest"].removeprefix("sha256:"),
        actor="operator-orchestration-service",
    )
    if replayed["ledger"]["resolution"] != "reused" or read["ledger"]["resolution"] != "read":
        raise RuntimeError("Closure readiness issue, replay, or readback failed")
    if not (issued["readiness"] == replayed["readiness"] == read["readiness"]):
        raise RuntimeError("Closure readiness changed across replay or readback")
    json.dump({
        "result": issued,
        "proof": {
            "studio_revision": revision(studio_root),
            "wgcf_revision": revision(wgcf_root),
            "issue_resolution": issued["ledger"]["resolution"],
            "replay_resolution": replayed["ledger"]["resolution"],
            "readback_resolution": read["ledger"]["resolution"],
            "readiness_digest": issued["readiness"]["readiness_digest"],
            "request_id": evaluation["request"]["request_id"],
            "evidence_kind": "synthetic-owner-fixture",
        },
    }, sys.stdout, sort_keys=True, separators=(",", ":"))


if __name__ == "__main__":
    main()
