// Application quality is independent from reviewed source-control validation.
// Existing profiles retain their prior obligations unless they opt into this
// explicit, source-reviewed metadata. A plan never means verification passed.
export function applicationVerificationState(profile) {
  const plan = profile.application_verification;
  const applicationCommands = profile.commands.filter(command => command.scope !== "source-controls");
  return {
    mode: plan?.mode ?? "legacy",
    configured: plan ? plan.mode !== "unconfigured" : applicationCommands.some(command => command.kind === "tests"),
    manualChecks: structuredClone(plan?.manual_checks ?? []),
    applicationCommands,
    sourceCommands: profile.commands.filter(command => command.scope === "source-controls"),
    passed: false,
  };
}

export function sourceControlEvidenceProfile(ownerRepo) {
  return {
    schema_version: 1, profile_id: "owner-source-controls", owner_repo: ownerRepo,
    application_verification: { mode: "unconfigured", manual_checks: [] },
    commands: [
      { id: "source-controls", kind: "validations", name: "Validate reviewed source-owner controls; not application acceptance",
        executable: "python3", args: ["scripts/validate_owner.py", "--repo-root", "."], fidelity: "filesystem",
        conformance_binding: "none", timeout_seconds: 120, scope: "source-controls" },
      { id: "source-diff", kind: "validations", name: "Validate the exact source diff; not application acceptance",
        executable: "git", args: ["diff", "--check", "{{base_commit}}...{{head_commit}}"], fidelity: "real-git",
        conformance_binding: "none", timeout_seconds: 120, scope: "source-controls" },
    ],
  };
}

export function applicationEvidenceKinds(profile, targetReadiness = "merge-ready") {
  const state = applicationVerificationState(profile);
  if (["unconfigured", "manual"].includes(state.mode) && targetReadiness === "merge-ready") return ["validations"];
  return ["tests", "validations"];
}
