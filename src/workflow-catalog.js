const IDEA_LIFECYCLE_STATUSES = Object.freeze([
  {
    next_step:
      "Review the captured record, then move it into triage or park it in the canonical backlog.",
    meaning: "Raw record exists, but no approved triage or ownership decision exists yet.",
    status: "captured",
  },
  {
    next_step:
      "Confirm the framing, assign the right proposal type or owner, or park it if it is not ready.",
    meaning:
      "An operator-authored or operator-accepted framing exists and the idea now has a clearer shape.",
    status: "triaged",
  },
  {
    next_step:
      "Set a revisit point or bring it back into owner assignment when it becomes actionable.",
    meaning: "Worth keeping, but intentionally deferred instead of moving into active work right now.",
    status: "parked",
  },
  {
    next_step:
      "Promote it into an accepted proposal or concrete owner-repo work when the next action is clear.",
    meaning: "A durable owning repo, product, or component has been identified for the idea.",
    status: "owner-assigned",
  },
  {
    next_step:
      "Promote it into the next governed artifact such as an ADR, review, change plan, or delivery work item.",
    meaning: "Ready to move out of the proposal backlog and into concrete governed work.",
    status: "accepted",
  },
  {
    next_step:
      "Keep the record for traceability only; do not continue active work unless it is explicitly reopened.",
    meaning: "Explicitly not proceeding in its current form.",
    status: "rejected",
  },
  {
    next_step:
      "Link the realized outcome if needed, but do not continue using the backlog item as active work.",
    meaning: "The intended outcome already landed elsewhere.",
    status: "implemented",
  },
  {
    next_step:
      "Use the newer record as the active reference and keep this one only as historical context.",
    meaning: "Replaced by a newer or better-framed idea.",
    status: "superseded",
  },
]);

const IDEA_LIFECYCLE_STATUS_NAMES = Object.freeze(
  IDEA_LIFECYCLE_STATUSES.map((entry) => entry.status),
);

const IDEA_COMMAND_DESCRIPTOR = Object.freeze({
  lifecycle_note:
    "The canonical backlog supports the full status model now. Telegram currently exposes capture, operator-authored triage, bounded decision for `parked`, `accepted`, and `rejected`, plus list, list all, and show. The reserved placeholder `/idea triage discuss <idea-id>` is not implemented yet, and `owner-assigned` remains broker-managed until an explicit owner vocabulary is enabled.",
  lifecycle_statuses: IDEA_LIFECYCLE_STATUSES,
  operator_guidance: {
    after_capture: [
      "each reply includes the canonical idea id, record reference, and current status",
      "use /idea show <idea-id> to inspect one stored record in detail",
      "use /idea triage <idea-id> <summary> when the raw capture is clear enough to frame from Telegram alone",
      "use /idea decide <idea-id> <parked|accepted|rejected> <notes> when the next durable outcome is clear",
      "use /idea list to review the latest submitted ideas with their statuses",
      "use /idea list all when you need the full stored backlog instead of only the recent slice",
      "use /idea list status <status> when you need to focus on one lifecycle state",
    ],
    examples: [
      "We need a governed place to capture deferred architecture ideas before they become Git artifacts",
      "Add a prod-safe traffic-stop lane for future shared products",
    ],
    what_to_send: [
      "use `/idea <text>` to capture a new idea",
      "use `/idea triage <idea-id> <summary>` to record operator-authored framing and move a captured item into `triaged`",
      "use `/idea decide <idea-id> <parked|accepted|rejected> <notes>` to record the first bounded durable decision",
      "use `/idea list` to review the recent idea slice",
      "use `/idea list all` to review every stored idea through broker pagination",
      "use `/idea list status <status>` to review one status slice such as `captured` or `parked`",
      "use `/idea show <idea-id>` to inspect one stored idea record",
    ],
  },
  purpose:
    "Create, inspect, and list canonical idea records in Workspace Proposals through the broker-owned operator workflow path.",
  record_system: "openproject",
  source_hints: {
    telegram: {
      command_descriptors: [
        {
          invocation: "/idea <idea text>",
          purpose: "Capture a new idea into the canonical backlog.",
        },
        {
          invocation: "/idea triage <idea-id> <summary>",
          purpose: "Record operator-authored triage framing and move the idea into triaged.",
        },
        {
          invocation: "/idea decide <idea-id> <parked|accepted|rejected> <notes>",
          purpose: "Record the next bounded durable outcome without exposing owner-assignment yet.",
        },
        {
          invocation: "/idea list",
          purpose: "Show the recent stored idea slice with current statuses.",
        },
        {
          invocation: "/idea list all",
          purpose: "Show the full stored idea backlog through broker pagination.",
        },
        {
          invocation: "/idea list status <status>",
          purpose: "Show the recent stored idea slice filtered by one canonical status.",
        },
        {
          invocation: "/idea list all status <status>",
          purpose: "Show the full stored idea backlog filtered by one canonical status.",
        },
        {
          invocation: "/idea show <idea-id>",
          purpose: "Inspect one stored idea record in detail.",
        },
        {
          invocation: "/idea help",
          purpose: "Show the canonical workflow guidance and lifecycle status model.",
        },
      ],
      help_invocation: "/idea help",
      invocation_examples: [
        "/idea <idea text>",
        "/idea triage <idea-id> <summary>",
        "/idea decide <idea-id> <parked|accepted|rejected> <notes>",
        "/idea list",
        "/idea list all",
        "/idea list status <status>",
        "/idea list all status <status>",
        "/idea show <idea-id>",
        "/idea help",
      ],
      note:
        "Use `/idea <text>` to capture a new idea. Use `/idea triage <idea-id> <summary>` to record operator-authored framing, then `/idea decide <idea-id> <parked|accepted|rejected> <notes>` for the first durable outcome. The reserved placeholder `/idea triage discuss <idea-id>` is not implemented yet.",
    },
  },
  summary:
    "Broker-owned command-family descriptor for creating and reading idea records without exposing backend-specific semantics to source adapters.",
  supports: {
    capture: true,
    decision: true,
    list_projection: true,
    read_projection: true,
    source_lookup: true,
    triage: true,
  },
  title: "Idea workflow",
  workflow_id: "idea-command",
});

const IDEA_CAPTURE_DESCRIPTOR = Object.freeze({
  input_contract: {
    optional: [
      "body",
      "operator.handle",
      "source.integration_id",
      "source.context_ref",
      "source.native_ref",
    ],
    required: ["operator.id", "source.surface", "title"],
  },
  operator_guidance: {
    after_capture: [
      "review the returned idea id and canonical record reference",
      "when the framing is clear enough from phone-only access, use `/idea triage <idea-id> <summary>` to record the first bounded triage outcome",
      "use the broker read projection when you need to confirm what was stored",
      "triage and ownership assignment come later through separate broker workflows",
    ],
    examples: [
      "We need a governed place to capture deferred architecture ideas before they become Git artifacts",
      "Add a prod-safe traffic-stop lane for future shared products",
    ],
    what_to_send: [
      "the idea itself or the problem worth tracking",
      "enough context to recognize it later",
      "one message is enough; triage and ownership come later",
    ],
  },
  purpose:
    "Capture a concrete idea or problem statement into Workspace Proposals before triage and ownership decisions.",
  record_system: "openproject",
  source_hints: {
    telegram: {
      help_invocation: "/idea help",
      invocation_examples: ["/idea <idea text>", "/idea help"],
      note:
        "Use a single message in the same chat or topic where the idea came up.",
    },
  },
  summary:
    "Create or reuse the initial canonical idea record in OpenProject through the broker-owned workflow path.",
  supports: {
    capture: true,
    decision: false,
    list_projection: true,
    read_projection: true,
    source_lookup: true,
    triage: true,
  },
  title: "Idea capture",
  workflow_id: "idea-capture",
});

const IDEA_TRIAGE_DESCRIPTOR = Object.freeze({
  input_contract: {
    optional: ["operator.handle"],
    required: ["operator.id", "input.summary", "idea_id"],
  },
  operator_guidance: {
    after_capture: [
      "triage is the phone-friendly framing step, not the final durable decision step",
      "use it to move a captured item into triaged with an operator-authored summary",
      "the reserved placeholder `/idea triage discuss <idea-id>` is not implemented yet",
    ],
    examples: [
      "Move this into triaged: needs a bounded broker workflow before decision",
      "Frame this as a deferred platform contract cleanup instead of a product bug",
    ],
    what_to_send: [
      "the canonical idea id such as `idea-37`",
      "one bounded operator-authored summary that makes the next decision easier",
      "use `/idea triage <idea-id> <summary>` from Telegram when desktop Codex access is unavailable",
    ],
  },
  purpose:
    "Record operator-authored triage framing for an existing idea and move it into the triaged state without requiring AI assistance.",
  record_system: "openproject",
  source_hints: {
    telegram: {
      help_invocation: "/idea help",
      invocation_examples: [
        "/idea triage idea-37 Needs a bounded broker workflow before decision",
      ],
      note:
        "Use `/idea triage <idea-id> <summary>` for the first bounded framing step. `/idea triage discuss <idea-id>` is reserved for a future AI-assisted path and is not implemented yet.",
    },
  },
  summary:
    "Move a captured idea into triaged with a concise operator-authored summary that remains usable from Telegram alone.",
  supports: {
    capture: true,
    decision: true,
    list_projection: true,
    read_projection: true,
    source_lookup: true,
    triage: true,
  },
  title: "Idea triage",
  workflow_id: "idea-triage",
});

const IDEA_DECISION_DESCRIPTOR = Object.freeze({
  input_contract: {
    optional: ["operator.handle"],
    required: ["operator.id", "input.notes", "input.status", "idea_id"],
  },
  operator_guidance: {
    after_capture: [
      "decision is the first durable outcome step after triage framing",
      "the current bounded statuses are `parked`, `accepted`, and `rejected`",
      "`owner-assigned` stays deferred until the owner vocabulary is explicit",
    ],
    examples: [
      "Park this until the owner-assigned model is ready",
      "Accept this and promote it into the next governed artifact later",
    ],
    what_to_send: [
      "the canonical idea id such as `idea-37`",
      "one of `parked`, `accepted`, or `rejected`",
      "one bounded note that explains the outcome for later readback",
    ],
  },
  purpose:
    "Record the first durable bounded decision for an existing idea without exposing owner-assignment yet.",
  record_system: "openproject",
  source_hints: {
    telegram: {
      help_invocation: "/idea help",
      invocation_examples: [
        "/idea decide idea-37 parked Revisit after the owner-assigned vocabulary lands",
        "/idea decide idea-38 accepted Ready to turn this into a governed artifact next",
      ],
      note:
        "Use `/idea decide <idea-id> <parked|accepted|rejected> <notes>` after triage. `owner-assigned` is not exposed yet.",
    },
  },
  summary:
    "Move a triaged idea into a first durable outcome with operator-authored decision notes.",
  supports: {
    capture: true,
    decision: true,
    list_projection: true,
    read_projection: true,
    source_lookup: true,
    triage: true,
  },
  title: "Idea decision",
  workflow_id: "idea-decision",
});

const WORKFLOW_DESCRIPTORS = Object.freeze([
  IDEA_COMMAND_DESCRIPTOR,
  IDEA_CAPTURE_DESCRIPTOR,
  IDEA_TRIAGE_DESCRIPTOR,
  IDEA_DECISION_DESCRIPTOR,
]);

export function listWorkflowDescriptors() {
  return WORKFLOW_DESCRIPTORS;
}

export function getWorkflowDescriptor(workflowId) {
  return WORKFLOW_DESCRIPTORS.find((workflow) => workflow.workflow_id === workflowId) ?? null;
}

export function listIdeaLifecycleStatuses() {
  return IDEA_LIFECYCLE_STATUS_NAMES;
}

export function normalizeIdeaLifecycleStatus(value) {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  return IDEA_LIFECYCLE_STATUS_NAMES.includes(normalized) ? normalized : null;
}
