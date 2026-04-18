#!/usr/bin/env python3
"""Validate that security-significant PR changes include a tagged change record."""

from __future__ import annotations

import argparse
import fnmatch
import subprocess
from pathlib import Path
import re
import sys

import yaml


CHANGE_RECORD_RE = re.compile(r"\d{4}-\d{2}-\d{2}-[a-z0-9-]+\.md$")


def load_yaml(path: Path) -> dict:
    return yaml.safe_load(path.read_text()) or {}


def changed_files(repo_root: Path, against_ref: str) -> list[str]:
    proc = subprocess.run(
        ["git", "diff", "--name-only", "--diff-filter=ACMR", f"{against_ref}...HEAD"],
        cwd=repo_root,
        check=True,
        text=True,
        capture_output=True,
    )
    return [line.strip() for line in proc.stdout.splitlines() if line.strip()]


def parse_front_matter(path: Path) -> dict:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}
    parts = text.split("\n---\n", 1)
    if len(parts) != 2:
        return {}
    return yaml.safe_load(parts[0][4:]) or {}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--against-ref")
    parser.add_argument("--changed-file", action="append", default=[])
    args = parser.parse_args()

    repo_root = Path(args.repo_root).resolve()
    policy = load_yaml(repo_root / "docs" / "records" / "change-records" / "policy.yaml")
    policy_root = policy.get("security_change_record_policy") or {}
    change_record_dir = policy_root.get("change_record_dir") or "docs/records/change-records"
    rules = policy_root.get("rules") or []
    if args.changed_file:
        changed = list(args.changed_file)
    elif args.against_ref:
        changed = changed_files(repo_root, args.against_ref)
    else:
        print("ERROR: either --against-ref or at least one --changed-file is required")
        return 1

    required_areas: set[str] = set()
    matched: list[str] = []
    for rel_path in changed:
        for rule in rules:
            if any(fnmatch.fnmatch(rel_path, pattern) for pattern in rule.get("match_any") or []):
                matched.append(rel_path)
                required_areas.update(rule.get("required_review_areas") or [])
                break

    if not matched:
        print("no policy-matched security-significant source changes detected")
        return 0

    changed_records: list[str] = []
    for rel_path in changed:
        if not rel_path.startswith(f"{change_record_dir}/"):
            continue
        name = Path(rel_path).name
        if name in {"README.md", "TEMPLATE.md", "policy.yaml"}:
            continue
        if CHANGE_RECORD_RE.fullmatch(name):
            changed_records.append(rel_path)

    if not changed_records:
        print(
            "ERROR: matched security-significant changes require a change record under "
            f"{change_record_dir}.\nMatched files:\n- " + "\n- ".join(matched)
        )
        return 1

    for rel_path in changed_records:
        metadata = parse_front_matter(repo_root / rel_path)
        security_evidence = metadata.get("security_evidence") or {}
        review_areas = set(security_evidence.get("review_areas") or [])
        if review_areas and review_areas.intersection(required_areas):
            print(
                "change record requirement satisfied by "
                f"{rel_path} for matched files:\n- " + "\n- ".join(matched)
            )
            return 0

    print(
        "ERROR: changed change record(s) do not declare security_evidence.review_areas "
        f"covering the required areas {sorted(required_areas)!r}."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
