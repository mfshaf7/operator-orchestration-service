#!/usr/bin/env python3
"""Validate OpenProject mutation changes carry live-contract evidence."""

from __future__ import annotations

import argparse
import fnmatch
from pathlib import Path
import re
import subprocess


MUTATION_SURFACE_GLOBS = (
    "src/openproject-client.js",
    "src/delivery-service.js",
    "src/delivery-model.js",
    "src/delivery-planning-workflow.json",
    "src/delivery-initiative-review-workflow.json",
    "docs/contracts/delivery-workflow-api-v1.md",
    "docs/contracts/openproject-adapter-v1.md",
    "docs/operations/delivery-workflow-operator-surface.md",
)
TEST_GLOBS = (
    "test/openproject-client.test.js",
    "test/delivery-service.test.js",
)
CHANGE_RECORD_DIR = "docs/records/change-records"
CHANGE_RECORD_RE = re.compile(r"\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$")
CONTRACT_EVIDENCE_MARKERS = (
    "allowedValues",
    "form schema",
    "PropertyIsReadOnly",
    "writable",
    "read-only",
    "version_field_read_only",
    "roadmap_version_projection",
)


def changed_files(repo_root: Path, against_ref: str) -> list[str]:
    proc = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=ACMR", f"{against_ref}...HEAD"],
        cwd=repo_root,
        check=True,
        text=True,
        capture_output=True,
    )
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def matches_any(path: str, patterns: tuple[str, ...]) -> bool:
    return any(fnmatch.fnmatch(path, pattern) for pattern in patterns)


def is_change_record(path: str) -> bool:
    return (
        path.startswith(f"{CHANGE_RECORD_DIR}/")
        and CHANGE_RECORD_RE.fullmatch(Path(path).name) is not None
    )


def file_contains_any(repo_root: Path, rel_paths: list[str], markers: tuple[str, ...]) -> bool:
    for rel_path in rel_paths:
        path = repo_root / rel_path
        if not path.exists() or not path.is_file():
            continue
        text = path.read_text(encoding="utf-8")
        if any(marker in text for marker in markers):
            return True
    return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate OpenProject mutation surface changes include live contract evidence.",
    )
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--against-ref")
    parser.add_argument("--changed-file", action="append", default=[])
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    if args.changed_file:
        changed = list(args.changed_file)
    elif args.against_ref:
        changed = changed_files(repo_root, args.against_ref)
    else:
        print("ERROR: either --against-ref or at least one --changed-file is required")
        return 1

    mutation_changes = [
        rel_path for rel_path in changed if matches_any(rel_path, MUTATION_SURFACE_GLOBS)
    ]
    if not mutation_changes:
        print("no OpenProject mutation contract changes detected")
        return 0

    test_changes = [rel_path for rel_path in changed if matches_any(rel_path, TEST_GLOBS)]
    record_changes = [rel_path for rel_path in changed if is_change_record(rel_path)]
    errors: list[str] = []

    if not test_changes:
        errors.append(
            "OpenProject mutation changes require a changed regression test under "
            + " or ".join(TEST_GLOBS)
        )
    elif not file_contains_any(repo_root, test_changes, CONTRACT_EVIDENCE_MARKERS):
        errors.append(
            "OpenProject mutation regression tests must include live contract markers "
            f"such as {', '.join(CONTRACT_EVIDENCE_MARKERS)}"
        )

    if not record_changes:
        errors.append(
            f"OpenProject mutation changes require a change record under {CHANGE_RECORD_DIR}"
        )
    elif not file_contains_any(repo_root, record_changes, CONTRACT_EVIDENCE_MARKERS):
        errors.append(
            "OpenProject mutation change records must state the live form contract evidence, "
            "including writability or allowed-values proof"
        )

    if errors:
        print("ERROR: OpenProject mutation contract gate failed")
        print("Matched mutation surface changes:")
        for rel_path in mutation_changes:
            print(f"- {rel_path}")
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print(
        "OpenProject mutation contract gate valid: "
        f"mutation_changes={len(mutation_changes)} "
        f"test_changes={len(test_changes)} "
        f"change_records={len(record_changes)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
