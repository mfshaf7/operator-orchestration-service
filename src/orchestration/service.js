import { ORCHESTRATION_API_PROCESS_ROLE } from "../config.js";
import { resolveActivationTarget } from "./activation-evidence.js";
import {
  getOrchestrationDefinition,
  listOrchestrationDefinitions,
  orchestrationActivationGates,
} from "./catalog.js";
import {
  normalizeRunControl,
  normalizeValidationReadinessRequest,
} from "./contracts.js";
import { VALIDATION_READINESS_API_CALLER_ID } from "./constants.js";
import {
  OrchestrationControlIdempotencyConflictError,
  OrchestrationControlNotAppliedError,
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
      assertActivation(config);
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
      const result = await activeAdapter().startRun(request);
      if (result.duplicate) {
        const mismatchedFields = duplicateBindingMismatches(
          result.projection,
          request,
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
      return result;
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

function throwMappedRuntimeError(error) {
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

function assertActivation(config) {
  const admission = orchestrationActivationGates(config);
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

function duplicateBindingMismatches(projection, request) {
  const expectedBindings = {
    request_id: request.request_id,
    definition_id: request.definition_id,
    definition_version: request.definition_version,
    source_domain: request.source_domain,
    source_record_ref: request.source_record_ref,
    source_version_ref: request.source_version_ref,
    source_projection_ref: request.source_projection_ref,
    source_projection_version: request.source_projection_version,
    intent_digest: request.intent_digest,
    correlation_ref: request.correlation_ref,
    causation_ref: request.causation_ref,
    caller_ref: request.caller_id,
    operator_ref: request.operator_id,
    approval_ref: request.approval_refs[0].decision_ref,
  };

  return Object.entries(expectedBindings)
    .filter(([field, value]) => projection?.[field] !== value)
    .map(([field]) => field);
}
