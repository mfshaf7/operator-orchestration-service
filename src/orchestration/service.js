import { ORCHESTRATION_API_PROCESS_ROLE } from "../config.js";
import { resolveActivationTarget } from "./activation-evidence.js";
import {
  getOrchestrationDefinition,
  listOrchestrationDefinitions,
  resolveOrchestrationActivationAdmission,
} from "./catalog.js";
import {
  controlledProofExecutionFor,
  controlledProofRunBindingMismatches,
  controlledProofRunIdFor,
  controlledProofWorkflowInputFor,
  normalizeControlledProofControlRequest,
  normalizeControlledProofStartRequest,
} from "./controlled-proof-contracts.js";
import { resolveControlledProofContext } from "./controlled-proof-evidence.js";
import {
  normalizeRunControl,
  normalizeValidationReadinessRequest,
  temporalRunBindingMismatches,
} from "./contracts.js";
import {
  CONTROLLED_PROOF_EXECUTOR_CALLER_ID,
  VALIDATION_READINESS_API_CALLER_ID,
} from "./constants.js";
import {
  ControlledProofRunBindingUnverifiedError,
  OrchestrationControlIdempotencyConflictError,
  OrchestrationControlNotAppliedError,
  OrchestrationGenerationCapacityExhaustedError,
  OrchestrationRunBindingUnverifiedError,
  OrchestrationRunNotFoundError,
  createTemporalAdapter,
} from "./temporal-adapter.js";

export class OrchestrationServiceError extends Error {
  constructor(code, message, { statusCode = 400, details = null } = {}) {
    super(message);
    this.name = "OrchestrationServiceError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export function createOrchestrationService({
  config,
  temporalAdapter,
  temporalClientFactory,
}) {
  let adapter = temporalAdapter ?? null;

  function activeAdapter() {
    if (!adapter) {
      adapter = createTemporalAdapter({
        config: config.orchestration.temporal,
        clientFactory: temporalClientFactory,
      });
    }
    return adapter;
  }

  return {
    listDefinitions() {
      return listOrchestrationDefinitions(config);
    },

    getDefinition(definitionId, definitionVersion) {
      return getOrchestrationDefinition(
        definitionId,
        definitionVersion,
        config,
      );
    },

    async startRun(payload, { callerId }) {
      assertOperatorCockpitCaller(callerId, config);
      const activation = assertActivation(config);
      const request = normalizeValidationReadinessRequest(payload, {
        callerId,
      });
      const definition = getOrchestrationDefinition(
        request.definition_id,
        request.definition_version,
        config,
      );
      if (!definition) {
        throw new OrchestrationServiceError(
          "orchestration_definition_not_found",
          "The requested orchestration definition version does not exist.",
          { statusCode: 404 },
        );
      }
      let result;
      try {
        result = await activeAdapter().startRun(request, {
          activationEvidenceDigest: activation.activation_evidence_digest,
        });
      } catch (error) {
        throwMappedRuntimeError(error);
      }
      if (result.duplicate) {
        const mismatchedFields = temporalRunBindingMismatches(
          result.bindings,
          request,
          activation.activation_evidence_digest,
        );
        if (mismatchedFields.length > 0) {
          throw new OrchestrationServiceError(
            "orchestration_idempotency_conflict",
            "The idempotency key already identifies a run with different immutable request bindings.",
            {
              statusCode: 409,
              details: { mismatched_fields: mismatchedFields },
            },
          );
        }
      }
      return {
        duplicate: result.duplicate,
        run_id: result.runId,
        projection: result.projection,
      };
    },

    async getRun(runId, { callerId } = {}) {
      assertOperatorCockpitCaller(callerId, config);
      assertRuntimeReadable(config);
      try {
        return await activeAdapter().getRun(runId);
      } catch (error) {
        throwMappedRuntimeError(error);
      }
    },

    async listRuns({ limit, callerId }) {
      assertOperatorCockpitCaller(callerId, config);
      if (!config.orchestration.runtimeEnabled) {
        return [];
      }
      assertRuntimeReadable(config);
      return activeAdapter().listRuns({ limit });
    },

    async controlRun(runId, payload, { callerId } = {}) {
      assertOperatorCockpitCaller(callerId, config);
      assertActivation(config);
      const control = normalizeRunControl(payload);
      const targetAdapter = activeAdapter();
      let projection;
      try {
        projection = await targetAdapter.getRun(runId);
      } catch (error) {
        throwMappedRuntimeError(error);
      }
      const availability = projection.control_availability?.find(
        (entry) => entry.action === control.action,
      );
      if (!availability?.available) {
        throw new OrchestrationServiceError(
          "orchestration_control_unavailable",
          `The ${control.action} control is not available in the current run state.`,
          {
            statusCode: 409,
            details: {
              action: control.action,
              run_id: runId,
              state: projection.state,
            },
          },
        );
      }
      try {
        return await targetAdapter.controlRun(runId, control);
      } catch (error) {
        throwMappedRuntimeError(error);
      }
    },

    async startControlledProofExecution(payload, { callerId }) {
      assertControlledProofCaller(callerId, config);
      const contextRecord = admittedControlledProofContext(config);
      const start = normalizeControlledProofStartRequest(payload);
      const execution = controlledProofExecutionFor(
        contextRecord.context,
        start.scenario_execution_id,
        { contextDigest: contextRecord.contextDigest },
      );
      const workflowInput = controlledProofWorkflowInputFor(
        contextRecord.context,
        execution,
      );
      let result;
      try {
        result = await activeAdapter().startControlledProofRun(
          contextRecord,
          execution,
        );
      } catch (error) {
        throwMappedRuntimeError(error);
      }
      if (result.duplicate) {
        const mismatchedFields = controlledProofRunBindingMismatches(
          result.bindings,
          workflowInput,
        );
        if (mismatchedFields.length > 0) {
          throw new OrchestrationServiceError(
            "controlled_proof_idempotency_conflict",
            "The scenario execution already identifies a workflow with different immutable proof bindings.",
            {
              statusCode: 409,
              details: { mismatched_fields: mismatchedFields },
            },
          );
        }
      }
      return controlledProofServiceResult(result, execution);
    },

    async getControlledProofExecution(runId, { callerId }) {
      assertControlledProofCaller(callerId, config);
      const contextRecord = admittedControlledProofContext(config, {
        allowExpired: true,
      });
      const execution = controlledProofExecutionForRunId(
        contextRecord,
        runId,
      );
      let result;
      try {
        result = await activeAdapter().getControlledProofRun(
          runId,
          contextRecord,
          execution,
        );
      } catch (error) {
        throwMappedRuntimeError(error);
      }
      return controlledProofServiceResult(result, execution);
    },

    async controlControlledProofExecution(
      runId,
      payload,
      { callerId },
    ) {
      assertControlledProofCaller(callerId, config);
      const envelope = normalizeControlledProofControlRequest(payload);
      const contextRecord = admittedControlledProofContext(config, {
        allowExpired: envelope.control.action === "cancel",
      });
      const execution = controlledProofExecutionFor(
        contextRecord.context,
        envelope.scenario_execution_id,
        { contextDigest: contextRecord.contextDigest },
      );
      if (
        envelope.commissioning_session_id !==
          execution.commissioning_session_id ||
        controlledProofRunIdFor(execution) !== runId ||
        envelope.control.operator_id !==
          contextRecord.context.request_binding.operator_id
      ) {
        throw new OrchestrationServiceError(
          "controlled_proof_control_binding_mismatch",
          "The control does not match the authorized commissioning session and scenario execution.",
          { statusCode: 409 },
        );
      }

      let current;
      try {
        current = await activeAdapter().getControlledProofRun(
          runId,
          contextRecord,
          execution,
        );
      } catch (error) {
        throwMappedRuntimeError(error);
      }
      const availability = current.projection.control_availability.find(
        (entry) => entry.action === envelope.control.action,
      );
      if (!availability?.available) {
        throw new OrchestrationServiceError(
          "controlled_proof_control_unavailable",
          `The ${envelope.control.action} control is unavailable in the current scenario state.`,
          {
            statusCode: 409,
            details: {
              action: envelope.control.action,
              run_id: runId,
              state: current.projection.state,
            },
          },
        );
      }

      let result;
      try {
        result = await activeAdapter().controlControlledProofRun(
          runId,
          envelope,
          contextRecord,
          execution,
        );
      } catch (error) {
        throwMappedRuntimeError(error);
      }
      return controlledProofServiceResult(result, execution);
    },
  };
}

function assertOperatorCockpitCaller(callerId, config) {
  if (callerId !== VALIDATION_READINESS_API_CALLER_ID) {
    throw new OrchestrationServiceError(
      "orchestration_caller_forbidden",
      "The authenticated caller is not admitted to the durable orchestration run surface.",
      { statusCode: 403 },
    );
  }
  if (
    !config.callerAuth.sharedSecret.trim() ||
    !config.callerAuth.allowedIds.includes(
      VALIDATION_READINESS_API_CALLER_ID,
    )
  ) {
    throw new OrchestrationServiceError(
      "orchestration_caller_auth_not_configured",
      "The durable orchestration run surface requires an authenticated admitted console caller.",
      { statusCode: 503 },
    );
  }
}

function assertControlledProofCaller(callerId, config) {
  if (callerId !== CONTROLLED_PROOF_EXECUTOR_CALLER_ID) {
    throw new OrchestrationServiceError(
      "controlled_proof_caller_forbidden",
      "The authenticated caller is not the admitted Platform controlled-proof executor.",
      { statusCode: 403 },
    );
  }
  if (
    !config.callerAuth.sharedSecret.trim() ||
    !config.callerAuth.allowedIds.includes(
      CONTROLLED_PROOF_EXECUTOR_CALLER_ID,
    )
  ) {
    throw new OrchestrationServiceError(
      "controlled_proof_caller_auth_not_configured",
      "Controlled proof execution requires an explicitly admitted authenticated Platform executor.",
      { statusCode: 503 },
    );
  }
}

function throwMappedRuntimeError(error) {
  if (error instanceof ControlledProofRunBindingUnverifiedError) {
    throw new OrchestrationServiceError(
      "controlled_proof_run_binding_unverified",
      "The retained controlled proof workflow cannot be admitted under the pinned commissioning context.",
      {
        statusCode: 503,
        details: { run_id: error.runId },
      },
    );
  }
  if (error instanceof OrchestrationGenerationCapacityExhaustedError) {
    throw new OrchestrationServiceError(
      "orchestration_generation_capacity_exhausted",
      "The active orchestration generation is full. Retire it and activate a fresh generation before retrying.",
      {
        statusCode: 409,
        details: {
          activation_evidence_digest: error.activationEvidenceDigest,
          maximum_registration_count: error.maximumRegistrationCount,
          required_action: "retire-and-activate-fresh-generation",
        },
      },
    );
  }
  if (error instanceof OrchestrationRunBindingUnverifiedError) {
    throw new OrchestrationServiceError(
      "orchestration_run_binding_unverified",
      "The retained durable run cannot be admitted as an idempotent duplicate.",
      {
        statusCode: 503,
        details: { run_id: error.runId },
      },
    );
  }
  if (error instanceof OrchestrationControlIdempotencyConflictError) {
    throw new OrchestrationServiceError(
      "orchestration_control_idempotency_conflict",
      "The control id or idempotency key already identifies a different immutable control request.",
      {
        statusCode: 409,
        details: {
          action: error.action,
          run_id: error.runId,
          state: error.projection.state,
          mismatched_fields: error.mismatchedFields,
        },
      },
    );
  }
  if (error instanceof OrchestrationControlNotAppliedError) {
    throw new OrchestrationServiceError(
      "orchestration_control_not_applied",
      "The run changed before the requested control was applied. Review the retained state before retrying.",
      {
        statusCode: 409,
        details: {
          action: error.action,
          run_id: error.runId,
          state: error.projection.state,
          control_applied: false,
        },
      },
    );
  }
  if (error instanceof OrchestrationRunNotFoundError) {
    throw new OrchestrationServiceError(
      "orchestration_run_not_found",
      "The durable orchestration run was not found.",
      { statusCode: 404 },
    );
  }
  throw error;
}

function admittedControlledProofContext(
  config,
  { allowExpired = false } = {},
) {
  const resolved = resolveControlledProofContext(config, { allowExpired });
  if (!resolved.valid) {
    throw new OrchestrationServiceError(
      "controlled_proof_not_admitted",
      resolved.message,
      {
        statusCode: resolved.reason === "disabled" ? 409 : 503,
        details: { reason: resolved.reason },
      },
    );
  }
  return resolved;
}

function controlledProofExecutionForRunId(contextRecord, runId) {
  for (const scenario of contextRecord.context.commissioning_session
    .scenario_executions) {
    const execution = controlledProofExecutionFor(
      contextRecord.context,
      scenario.scenario_execution_id,
      { contextDigest: contextRecord.contextDigest },
    );
    if (controlledProofRunIdFor(execution) === runId) {
      return execution;
    }
  }
  throw new OrchestrationServiceError(
    "controlled_proof_run_not_authorized",
    "The run id is not part of the pinned commissioning session.",
    { statusCode: 404 },
  );
}

function controlledProofServiceResult(result, execution) {
  return {
    schema_version: 1,
    duplicate: result.duplicate ?? false,
    run_id: result.runId,
    commissioning_session_id: execution.commissioning_session_id,
    scenario_id: execution.scenario_id,
    scenario_execution_id: execution.scenario_execution_id,
    projection: result.projection,
    owner_receipt: result.ownerReceipt,
  };
}

function assertActivation(config) {
  const admission = resolveOrchestrationActivationAdmission(config);
  if (!admission.start_allowed) {
    throw new OrchestrationServiceError(
      "orchestration_not_admitted",
      "Durable orchestration starts are disabled until every activation gate is satisfied.",
      {
        statusCode: 409,
        details: admission.gates
          .filter((entry) => !entry.satisfied)
          .map((entry) => ({
            gate_id: entry.gate_id,
            owner: entry.owner,
          })),
      },
    );
  }
  return admission;
}

function assertRuntimeReadable(config) {
  if (!config.orchestration.runtimeEnabled) {
    throw new OrchestrationServiceError(
      "orchestration_runtime_disabled",
      "The durable runtime adapter is disabled.",
      { statusCode: 503 },
    );
  }
  const admittedTarget = resolveActivationTarget(config, {
    processRole: ORCHESTRATION_API_PROCESS_ROLE,
  });
  if (!admittedTarget.valid) {
    throw new OrchestrationServiceError(
      "orchestration_runtime_target_unverified",
      "The durable runtime target is not admitted for API access.",
      { statusCode: 503 },
    );
  }
}
