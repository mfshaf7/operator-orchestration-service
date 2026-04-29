#!/usr/bin/env python3
"""Validate OpenProject mutation changes carry live-contract evidence."""

from __future__ import annotations

import argparse
import fnmatch
from pathlib import Path
import re
import subprocess
from textwrap import dedent


SOURCE_MUTATION_SURFACE_GLOBS = (
    "src/openproject-client.js",
    "src/delivery-service.js",
    "src/delivery-model.js",
    "src/delivery-planning-workflow.json",
    "src/delivery-initiative-review-workflow.json",
)
DOCUMENTED_MUTATION_SURFACE_GLOBS = (
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
DOCUMENTED_MUTATION_MARKERS = (
    "POST /v1/",
    "PATCH /v1/",
    "PUT /v1/",
    "DELETE /v1/",
    "npm run art -- initiative governance",
    "npm run art -- initiative planning-repair",
    "npm run art -- initiative close ",
    "npm run art -- item blocker",
    "npm run art -- item complete",
    "npm run art -- item dependency",
    "npm run art -- item move",
    "npm run art -- item parking",
    "npm run art -- item stale-open-close",
    "npm run art -- item update",
    "planning-repair",
    "plan/apply",
    "bulk-update",
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


def changed_diff(repo_root: Path, against_ref: str, rel_path: str) -> str:
    proc = subprocess.run(
        [
            "git",
            "diff",
            "--unified=0",
            "--no-ext-diff",
            f"{against_ref}...HEAD",
            "--",
            rel_path,
        ],
        cwd=repo_root,
        check=True,
        text=True,
        capture_output=True,
    )
    return proc.stdout


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


def diff_contains_any(diff_text: str, markers: tuple[str, ...]) -> bool:
    normalized_markers = tuple(marker.casefold() for marker in markers)
    for line in diff_text.splitlines():
        if not line.startswith(("+", "-")):
            continue
        if line.startswith(("+++", "---")):
            continue
        normalized_line = line[1:].casefold()
        if any(marker in normalized_line for marker in normalized_markers):
            return True
    return False


def mutation_changes(repo_root: Path, changed: list[str], against_ref: str | None) -> list[str]:
    matches: list[str] = []
    for rel_path in changed:
        if matches_any(rel_path, SOURCE_MUTATION_SURFACE_GLOBS):
            matches.append(rel_path)
            continue
        if not matches_any(rel_path, DOCUMENTED_MUTATION_SURFACE_GLOBS):
            continue
        if against_ref is None:
            matches.append(rel_path)
            continue
        if diff_contains_any(
            changed_diff(repo_root, against_ref, rel_path),
            DOCUMENTED_MUTATION_MARKERS,
        ):
            matches.append(rel_path)
    return matches


def run_self_test() -> int:
    read_guidance_diff = dedent(
        """
        @@ -262 +262 @@
        - `npm run art -- initiative closeout-readiness <delivery-id>`
        + `npm run art -- initiative closeout-readiness <delivery-id> [--json]`
        @@ -286,0 +287,4 @@
        +Read-heavy ART commands print compact operator summaries by default. Use
        +`--json` only when the complete broker response is needed. If a non-JSON
        +response is still large, the CLI writes the full response under `.art/outputs/`.
        """,
    )
    mutation_route_diff = dedent(
        """
        @@ -1,0 +2 @@
        +Use `POST /v1/delivery-work-items/{work_item_id}/update` after form schema proof.
        """,
    )
    mutation_command_diff = dedent(
        """
        @@ -1,0 +2 @@
        +- `npm run art -- initiative close <delivery-id> <payload.json>`
        """,
    )
    closeout_readiness_diff = dedent(
        """
        @@ -1,0 +2 @@
        +- `npm run art -- initiative closeout-readiness <delivery-id> [--json]`
        """,
    )
    cases = (
        ("read-only output guidance", read_guidance_diff, False),
        ("mutation route guidance", mutation_route_diff, True),
        ("mutation command guidance", mutation_command_diff, True),
        ("closeout readiness read command", closeout_readiness_diff, False),
    )
    failures: list[str] = []
    for name, diff_text, expected in cases:
        actual = diff_contains_any(diff_text, DOCUMENTED_MUTATION_MARKERS)
        if actual != expected:
            failures.append(f"{name}: expected {expected}, got {actual}")
    if failures:
        print("ERROR: OpenProject mutation contract validator self-test failed")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print("OpenProject mutation contract validator self-test passed")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate OpenProject mutation surface changes include live contract evidence.",
    )
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--against-ref")
    parser.add_argument("--changed-file", action="append", default=[])
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return run_self_test()

    repo_root = Path(args.repo_root).resolve()
    if args.changed_file:
        changed = list(args.changed_file)
    elif args.against_ref:
        changed = changed_files(repo_root, args.against_ref)
    else:
        print("ERROR: either --against-ref or at least one --changed-file is required")
        return 1

    matched_mutation_changes = mutation_changes(repo_root, changed, args.against_ref)
    if not matched_mutation_changes:
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
        for rel_path in matched_mutation_changes:
            print(f"- {rel_path}")
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print(
        "OpenProject mutation contract gate valid: "
        f"mutation_changes={len(matched_mutation_changes)} "
        f"test_changes={len(test_changes)} "
        f"change_records={len(record_changes)}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
