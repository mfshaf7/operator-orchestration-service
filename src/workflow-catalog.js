const IDEA_COMMAND_DESCRIPTOR = Object.freeze({
  operator_guidance: {
    after_capture: [
      "each reply includes the canonical idea id, record reference, and current status",
      "use /idea show <idea-id> to inspect one stored record in detail",
      "use /idea list to review the latest submitted ideas with their statuses",
    ],
    examples: [
      "We need a governed place to capture deferred architecture ideas before they become Git artifacts",
      "Add a prod-safe traffic-stop lane for future shared products",
    ],
    what_to_send: [
      "use `/idea <text>` to capture a new idea",
      "use `/idea list` to review recent idea records",
      "use `/idea show <idea-id>` to inspect one stored idea record",
    ],
  },
  purpose:
    "Create, inspect, and list canonical idea records in Workspace Proposals through the broker-owned operator workflow path.",
  record_system: "openproject",
  source_hints: {
    telegram: {
      help_invocation: "/idea help",
      invocation_examples: [
        "/idea <idea text>",
        "/idea list",
        "/idea show <idea-id>",
        "/idea help",
      ],
      note:
        "Use `/idea <text>` to capture a new idea. Use `/idea list` and `/idea show <idea-id>` to read what is already stored.",
    },
  },
  summary:
    "Broker-owned command-family descriptor for creating and reading idea records without exposing backend-specific semantics to source adapters.",
  supports: {
    capture: true,
    decision: false,
    list_projection: true,
    read_projection: true,
    source_lookup: true,
    triage: false,
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
    triage: false,
  },
  title: "Idea capture",
  workflow_id: "idea-capture",
});

const WORKFLOW_DESCRIPTORS = Object.freeze([IDEA_COMMAND_DESCRIPTOR, IDEA_CAPTURE_DESCRIPTOR]);

export function listWorkflowDescriptors() {
  return WORKFLOW_DESCRIPTORS;
}

export function getWorkflowDescriptor(workflowId) {
  return WORKFLOW_DESCRIPTORS.find((workflow) => workflow.workflow_id === workflowId) ?? null;
}
