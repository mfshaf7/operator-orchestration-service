import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

import {
  responseHasExample,
  validateExampleAgainstMediaType,
  validateValueAgainstSchema,
} from "./api_contract_tools.mjs";
import { requiredDeliveryNarrativeHeadings } from "../src/delivery-taxonomy.js";
import {
  DELIVERY_ACTIVE_CREATE_ACTOR_INPUT_FIELDS,
  DELIVERY_CREATE_ALWAYS_REQUIRED_INPUT_FIELDS,
  DELIVERY_CREATE_REQUIRED_INPUT_FIELDS_BY_TYPE,
} from "../src/work-item-create-preflight.js";
import {
  projectCanonicalSchemaForOpenApi,
} from "./orchestration_openapi_schema_tools.mjs";
import {
  PROPOSAL_OPENAPI_SCHEMA_BINDINGS,
} from "./proposal_openapi_schema_tools.mjs";
import {
  DELIVERY_INGRESS_OPENAPI_SCHEMA_BINDINGS,
  deliveryIngressExternalRefMap,
} from "./delivery_ingress_openapi_schema_tools.mjs";
import {
  WORK_DESIGN_OPENAPI_SCHEMA_BINDINGS,
  projectWorkDesignSchemaForOpenApi,
  workDesignExternalRefMap,
} from "./work_design_openapi_schema_tools.mjs";
import {
  projectRefinementSchemaForOpenApi,
  REFINEMENT_OPENAPI_SCHEMA_BINDINGS,
  refinementExternalRefMap,
} from "./refinement_openapi_schema_tools.mjs";
import {
  CATALOG_OPENAPI_SCHEMA_BINDINGS,
  catalogExternalRefMap,
  projectCatalogSchemaForOpenApi,
} from "./catalog_openapi_schema_tools.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const orchestrationContractRoot = path.join(
  repoRoot,
  "contracts",
  "orchestration",
);
const proposalContractRoot = path.join(
  repoRoot,
  "contracts",
  "proposal-workflow",
);
const deliveryIngressContractRoot = path.join(
  repoRoot,
  "contracts",
  "delivery-ingress",
);
const workDesignContractRoot = path.join(repoRoot, "contracts", "work-design");
const refinementContractRoot = path.join(repoRoot, "contracts", "refinement");
const catalogContractRoot = path.join(repoRoot, "contracts", "catalog");
const redocPath = path.join(repoRoot, "docs", "api", "index.html");
const appPath = path.join(repoRoot, "src", "app.js");

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function hasNonEmptyText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function schemaAllowsNull(schema) {
  if (!schema || typeof schema !== "object") {
    return false;
  }
  if (Array.isArray(schema.type)) {
    return schema.type.includes("null");
  }
  return schema.type === "null";
}

function requireNullableSchemaProperty(spec, schemaName, propertyName) {
  const schema = spec.components?.schemas?.[schemaName];
  const property = schema?.properties?.[propertyName];
  if (!property) {
    fail(`components.schemas.${schemaName}.properties.${propertyName} is missing`);
  }
  if (!schemaAllowsNull(property)) {
    fail(
      `components.schemas.${schemaName}.properties.${propertyName} must allow null to match live broker responses`,
    );
  }
}

function requireSchema(spec, schemaName) {
  const schema = spec.components?.schemas?.[schemaName];
  if (!schema || typeof schema !== "object") {
    fail(`components.schemas.${schemaName} is missing`);
  }
  return schema;
}

function schemaRefName(schema) {
  return typeof schema?.$ref === "string" ? schema.$ref.split("/").pop() : null;
}

function requireRequiredProperties(schema, schemaName, requiredKeys) {
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  const missing = requiredKeys.filter((key) => !required.has(key));
  if (missing.length > 0) {
    fail(`components.schemas.${schemaName}.required is missing: ${missing.join(", ")}`);
  }
}

function requireStringArrayEquals(actual, expected, label) {
  if (!Array.isArray(actual)) {
    fail(`${label} must be an array`);
  }
  if (
    actual.length !== expected.length ||
    actual.some((entry, index) => entry !== expected[index])
  ) {
    fail(`${label} must equal ${JSON.stringify(expected)}`);
  }
}

function requirePiObjectiveCreateSchema(spec) {
  const createInput = requireSchema(spec, "DeliveryWorkItemCreateInput");
  const branchNames = Array.isArray(createInput.oneOf)
    ? createInput.oneOf.map((entry) => schemaRefName(entry)).filter(Boolean)
    : [];

  for (const requiredBranch of [
    "DeliveryGeneralWorkItemCreateInput",
    "DeliveryActivePiObjectiveCreateInput",
  ]) {
    if (!branchNames.includes(requiredBranch)) {
      fail(
        `components.schemas.DeliveryWorkItemCreateInput.oneOf must include ${requiredBranch}`,
      );
    }
  }

  const generalSchema = requireSchema(spec, "DeliveryGeneralWorkItemCreateInput");
  const generalTypes = generalSchema.properties?.type?.enum ?? [];
  if (generalTypes.includes("PI Objective")) {
    fail(
      "components.schemas.DeliveryGeneralWorkItemCreateInput.properties.type.enum must not include PI Objective",
    );
  }

  const piSchema = requireSchema(spec, "DeliveryActivePiObjectiveCreateInput");
  if (piSchema.properties?.type?.const !== "PI Objective") {
    fail(
      "components.schemas.DeliveryActivePiObjectiveCreateInput.properties.type.const must be PI Objective",
    );
  }

  const requiredPiKeys = [
    ...DELIVERY_CREATE_ALWAYS_REQUIRED_INPUT_FIELDS.map(([key]) => key),
    "status",
    "target_pi",
    "description",
    ...DELIVERY_ACTIVE_CREATE_ACTOR_INPUT_FIELDS.map(([key]) => key),
    ...DELIVERY_CREATE_REQUIRED_INPUT_FIELDS_BY_TYPE["PI Objective"].map(
      ([key]) => key,
    ),
  ];
  requireRequiredProperties(
    piSchema,
    "DeliveryActivePiObjectiveCreateInput",
    [...new Set(requiredPiKeys)],
  );

  requireStringArrayEquals(
    piSchema["x-oos-required-narrative-headings"],
    requiredDeliveryNarrativeHeadings({ typeName: "PI Objective" }),
    "components.schemas.DeliveryActivePiObjectiveCreateInput.x-oos-required-narrative-headings",
  );

  const createBody =
    spec.paths?.["/v1/delivery-work-items"]?.post?.requestBody?.content?.[
      "application/json"
    ];
  const piExample = createBody?.examples?.createActivePiObjective?.value;
  if (!piExample) {
    fail(
      "POST /v1/delivery-work-items request examples must include createActivePiObjective",
    );
  }

  const piExampleErrors = validateValueAgainstSchema(
    spec,
    createBody.schema,
    piExample,
    "POST /v1/delivery-work-items createActivePiObjective request",
  );
  if (piExampleErrors.length > 0) {
    fail(piExampleErrors.join("\n"));
  }
}

function requireOrchestrationCanonicalSchema(
  spec,
  schemaName,
  canonicalFilename,
) {
  const apiSchema = requireSchema(spec, schemaName);
  const canonicalPath = path.join(
    orchestrationContractRoot,
    canonicalFilename,
  );
  const canonicalSchema = JSON.parse(
    readFileSync(canonicalPath, "utf8"),
  );
  const expectedSchema = projectCanonicalSchemaForOpenApi({
    canonicalFilename,
    canonicalSchema,
    componentName: schemaName,
    existingSchema: apiSchema,
  });

  if (!isDeepStrictEqual(apiSchema, expectedSchema)) {
    fail(
      `components.schemas.${schemaName} must be the exact canonical OpenAPI projection; run npm run sync:orchestration-openapi-schemas`,
    );
  }
}

function requireOrchestrationCanonicalSchemas(spec) {
  for (const [schemaName, filename] of [
    ["OrchestrationRunRequest", "run-request.schema.json"],
    ["OrchestrationRunControl", "run-control.schema.json"],
    ["OrchestrationRunProjection", "run-projection.schema.json"],
    ["ControlledProofStartRequest", "controlled-proof-start-request.schema.json"],
    ["ControlledProofControlRequest", "controlled-proof-control-request.schema.json"],
    ["ControlledProofRunProjection", "controlled-proof-run-projection.schema.json"],
    ["ControlledProofOwnerReceipt", "controlled-proof-owner-receipt.schema.json"],
  ]) {
    requireOrchestrationCanonicalSchema(spec, schemaName, filename);
  }
}

function requireProposalCanonicalSchemas(spec) {
  const externalRefMap = Object.fromEntries(
    PROPOSAL_OPENAPI_SCHEMA_BINDINGS.flatMap(
      ({ canonicalFilename, componentName }) => {
        const schema = JSON.parse(
          readFileSync(
            path.join(proposalContractRoot, canonicalFilename),
            "utf8",
          ),
        );
        return [
          [canonicalFilename, componentName],
          [schema.$id, componentName],
        ];
      },
    ),
  );
  for (const { canonicalFilename, componentName } of
    PROPOSAL_OPENAPI_SCHEMA_BINDINGS) {
    const apiSchema = requireSchema(spec, componentName);
    const canonicalSchema = JSON.parse(
      readFileSync(
        path.join(proposalContractRoot, canonicalFilename),
        "utf8",
      ),
    );
    const expectedSchema = projectCanonicalSchemaForOpenApi({
      canonicalFilename,
      canonicalPath: `contracts/proposal-workflow/${canonicalFilename}`,
      canonicalSchema,
      componentName,
      externalRefMap,
      existingSchema: apiSchema,
    });

    if (!isDeepStrictEqual(apiSchema, expectedSchema)) {
      fail(
        `components.schemas.${componentName} must be the exact canonical OpenAPI projection; run npm run sync:proposal-openapi-schemas`,
      );
    }
  }
}

function requireDeliveryIngressCanonicalSchemas(spec) {
  const schemas = DELIVERY_INGRESS_OPENAPI_SCHEMA_BINDINGS.map((binding) => ({
    ...binding,
    schema: JSON.parse(
      readFileSync(
        path.join(deliveryIngressContractRoot, binding.canonicalFilename),
        "utf8",
      ),
    ),
  }));
  const externalRefMap = deliveryIngressExternalRefMap(
    schemas.map(({ componentName, schema }) => ({ componentName, schema })),
  );
  for (const { canonicalFilename, componentName, schema } of schemas) {
    const apiSchema = requireSchema(spec, componentName);
    const expectedSchema = projectCanonicalSchemaForOpenApi({
      canonicalFilename,
      canonicalPath: `contracts/delivery-ingress/${canonicalFilename}`,
      canonicalSchema: schema,
      componentName,
      externalRefMap,
      existingSchema: apiSchema,
    });
    if (!isDeepStrictEqual(apiSchema, expectedSchema)) {
      fail(
        `components.schemas.${componentName} must be the exact canonical ` +
        "OpenAPI projection; run npm run sync:delivery-ingress-openapi-schemas",
      );
    }
  }
}

function requireWorkDesignCanonicalSchemas(spec) {
  const schemas = WORK_DESIGN_OPENAPI_SCHEMA_BINDINGS.map(
    ({ canonicalFilename, componentName }) => ({
      canonicalFilename,
      componentName,
      schema: JSON.parse(
        readFileSync(
          path.join(workDesignContractRoot, canonicalFilename),
          "utf8",
        ),
      ),
    }),
  );
  const externalRefMap = workDesignExternalRefMap(schemas);
  for (const { canonicalFilename, componentName, schema } of schemas) {
    const apiSchema = requireSchema(spec, componentName);
    const expectedSchema = projectWorkDesignSchemaForOpenApi({
      canonicalFilename,
      canonicalSchema: schema,
      componentName,
      externalRefMap,
      existingSchema: apiSchema,
    });
    if (!isDeepStrictEqual(apiSchema, expectedSchema)) {
      fail(
        `components.schemas.${componentName} must be the exact canonical ` +
        "Work Design OpenAPI projection; run npm run sync:work-design-openapi-schemas",
      );
    }
  }
}

function requireRefinementCanonicalSchemas(spec) {
  const schemas = REFINEMENT_OPENAPI_SCHEMA_BINDINGS.map(
    ({ canonicalFilename, componentName }) => ({
      canonicalFilename,
      componentName,
      schema: JSON.parse(
        readFileSync(path.join(refinementContractRoot, canonicalFilename), "utf8"),
      ),
    }),
  );
  const externalRefMap = refinementExternalRefMap(schemas);
  for (const { canonicalFilename, componentName, schema } of schemas) {
    const apiSchema = requireSchema(spec, componentName);
    const expectedSchema = projectRefinementSchemaForOpenApi({
      canonicalFilename,
      canonicalSchema: schema,
      componentName,
      externalRefMap,
      existingSchema: apiSchema,
    });
    if (!isDeepStrictEqual(apiSchema, expectedSchema)) {
      fail(
        `components.schemas.${componentName} must be the exact canonical ` +
        "Refinement OpenAPI projection; run npm run sync:refinement-openapi-schemas",
      );
    }
  }
}

function requireCatalogCanonicalSchemas(spec) {
  const schemas = CATALOG_OPENAPI_SCHEMA_BINDINGS.map(
    ({ canonicalFilename, componentName }) => ({
      canonicalFilename,
      componentName,
      schema: JSON.parse(
        readFileSync(path.join(catalogContractRoot, canonicalFilename), "utf8"),
      ),
    }),
  );
  const externalRefMap = catalogExternalRefMap(schemas);
  for (const { canonicalFilename, componentName, schema } of schemas) {
    const apiSchema = requireSchema(spec, componentName);
    const expectedSchema = projectCatalogSchemaForOpenApi({
      canonicalFilename,
      canonicalSchema: schema,
      componentName,
      externalRefMap,
      existingSchema: apiSchema,
    });
    if (!isDeepStrictEqual(apiSchema, expectedSchema)) {
      fail(
        `components.schemas.${componentName} must be the exact canonical ` +
        "Catalog OpenAPI projection; run npm run sync:catalog-openapi-schemas",
      );
    }
  }
}

function requireControlledProofApiBoundary(spec) {
  const routes = [
    ["/v1/orchestration/controlled-proof/executions", "post"],
    ["/v1/orchestration/controlled-proof/executions/{run_id}", "get"],
    ["/v1/orchestration/controlled-proof/executions/{run_id}/controls", "post"],
  ];
  for (const [route, method] of routes) {
    const operation = spec.paths?.[route]?.[method];
    if (!operation) {
      fail(`controlled proof API is missing ${method.toUpperCase()} ${route}`);
    }
    if (operation["x-oos-surface"] !== "internal-controlled-proof") {
      fail(`${method.toUpperCase()} ${route} must remain internal-controlled-proof`);
    }
    if (
      operation["x-oos-primary-caller"] !==
      "platform-controlled-proof-executor"
    ) {
      fail(`${method.toUpperCase()} ${route} must admit only the Platform executor`);
    }
  }

  const response = requireSchema(spec, "ControlledProofExecutionResponse");
  requireRequiredProperties(response, "ControlledProofExecutionResponse", [
    "schema_version",
    "duplicate",
    "run_id",
    "commissioning_session_id",
    "scenario_id",
    "scenario_execution_id",
    "projection",
    "owner_receipt",
  ]);
}

function requireOrchestrationDefinitionSchema(spec) {
  const apiSchema = requireSchema(spec, "OrchestrationDefinition");
  const definition = JSON.parse(
    readFileSync(
      path.join(
        orchestrationContractRoot,
        "definitions",
        "validation-readiness-run.v1.json",
      ),
      "utf8",
    ),
  );
  const projectedFields = [...Object.keys(definition), "admission"].sort();

  if (apiSchema.additionalProperties !== false) {
    fail("components.schemas.OrchestrationDefinition must reject unknown fields");
  }
  requireStringArrayEquals(
    [...(apiSchema.required ?? [])].sort(),
    projectedFields,
    "components.schemas.OrchestrationDefinition.required",
  );
  requireStringArrayEquals(
    Object.keys(apiSchema.properties ?? {}).sort(),
    projectedFields,
    "components.schemas.OrchestrationDefinition.properties",
  );
}

function requireOrchestrationGenerationCapacityResponse(spec) {
  const schema = requireSchema(
    spec,
    "OrchestrationGenerationCapacityExhaustedError",
  );
  if (
    schema.properties?.error?.const !==
    "orchestration_generation_capacity_exhausted"
  ) {
    fail(
      "components.schemas.OrchestrationGenerationCapacityExhaustedError must expose the stable capacity error code",
    );
  }
  const response =
    spec.paths?.["/v1/orchestration/runs"]?.post?.responses?.["409"]
      ?.content?.["application/json"];
  const refs = Array.isArray(response?.schema?.anyOf)
    ? response.schema.anyOf.map((entry) => schemaRefName(entry))
    : [];
  if (!refs.includes("OrchestrationGenerationCapacityExhaustedError")) {
    fail(
      "POST /v1/orchestration/runs 409 must publish OrchestrationGenerationCapacityExhaustedError",
    );
  }
  const example = response?.examples?.generationCapacityExhausted?.value;
  const errors = validateValueAgainstSchema(spec, schema, example);
  if (errors.length > 0) {
    fail(
      `generationCapacityExhausted example does not match its schema: ${errors.join("; ")}`,
    );
  }
}

function normalizeRegexRoute(literal) {
  const trimmed = literal.trim();
  if (!trimmed.startsWith("/^") || !trimmed.endsWith("$/")) {
    fail(`unsupported route regex literal: ${literal}`);
  }

  const pattern = trimmed.slice(2, -2).replaceAll("\\/", "/");
  if (pattern.startsWith("/v1/ideas/")) {
    return pattern.replace("[^/]+", "{idea_id}");
  }
  if (pattern.startsWith("/v1/proposals/")) {
    return pattern
      .replace("[^/]+", "{proposal_id}")
      .replace("[^/]+", "{event_id}");
  }
  if (pattern.startsWith("/v1/delivery-ingress/prototype/applications/")) {
    return pattern.replace("[^/]+", "{application_id}");
  }
  if (pattern.startsWith("/v1/workflows/")) {
    return pattern.replace("[^/]+", "{workflow_id}");
  }
  if (pattern.startsWith("/v1/delivery-initiatives/")) {
    return pattern.replace("[^/]+", "{delivery_id}");
  }
  if (pattern.startsWith("/v1/delivery-work-items/")) {
    return pattern.replace("[^/]+", "{work_item_id}");
  }
  if (pattern.startsWith("/v1/delivery-work-design/")) {
    return pattern.replace("[^/]+", "{package_id}");
  }
  if (pattern.startsWith("/v1/delivery-refinement/")) {
    return pattern
      .replace("[^/]+", "{package_id}")
      .replace("[^/]+", "{run_id}");
  }
  if (pattern.startsWith("/v1/delivery-catalog/")) {
    return pattern.replace("[^/]+", "{catalog_item_id}");
  }
  if (pattern.startsWith("/v1/workspace-intake/requests/")) {
    return pattern.replace("[^/]+", "{request_id}");
  }
  if (pattern.startsWith("/v1/repository-custody/requests/")) {
    return pattern.replace("[^/]+", "{request_id}");
  }
  if (pattern.startsWith("/v1/repository-lifecycle/requests/")) {
    return pattern.replace("[^/]+", "{request_id}");
  }
  if (pattern.startsWith("/v1/repository-lifecycle/repositories/")) {
    return pattern
      .replace("[^/]+", "{provider}")
      .replace("[^/]+", "{provider_repository_id}");
  }
  if (pattern.startsWith("/v1/orchestration/definitions/")) {
    return pattern.replace("[^/]+", "{definition_id}");
  }
  if (pattern.startsWith("/v1/orchestration/runs/")) {
    return pattern.replace("[^/]+", "{run_id}");
  }
  if (pattern.startsWith("/v1/orchestration/controlled-proof/executions/")) {
    return pattern.replace("[^/]+", "{run_id}");
  }

  fail(`unsupported route regex family: ${literal}`);
}

function extractImplementedRoutes(appSource) {
  const routes = new Set();

  const exactRoutePattern =
    /request\.method === "([A-Z]+)"\s*&&\s*url\.pathname\s*===\s*"([^"]+)"/gms;
  for (const match of appSource.matchAll(exactRoutePattern)) {
    const [, method, route] = match;
    routes.add(`${method} ${route}`);
  }

  const regexRoutePattern =
    /request\.method === "([A-Z]+)"\s*&&\s*(\/\^[\s\S]*?\$\/)\.test\(\s*url\.pathname\s*,?\s*\)/gms;
  for (const match of appSource.matchAll(regexRoutePattern)) {
    const [, method, literal] = match;
    routes.add(`${method} ${normalizeRegexRoute(literal)}`);
  }

  return routes;
}

function extractDocumentedRoutes(spec) {
  const routes = new Set();
  const supportedMethods = new Set([
    "get",
    "post",
    "put",
    "patch",
    "delete",
    "options",
    "head",
  ]);

  for (const [route, operations] of Object.entries(spec.paths ?? {})) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!supportedMethods.has(method)) {
        continue;
      }
      if (!operation || typeof operation !== "object") {
        fail(`invalid OpenAPI operation object for ${method.toUpperCase()} ${route}`);
      }
      routes.add(`${method.toUpperCase()} ${route}`);
      if (route.startsWith("/v1/")) {
        if (!hasNonEmptyText(operation.description)) {
          fail(`missing operation description for ${method.toUpperCase()} ${route}`);
        }
        const security = operation.security;
        if (!Array.isArray(security) || security.length === 0) {
          fail(`missing caller auth security declaration for ${method.toUpperCase()} ${route}`);
        }
        if (!hasNonEmptyText(operation["x-oos-surface"])) {
          fail(`missing x-oos-surface for ${method.toUpperCase()} ${route}`);
        }
        if (!hasNonEmptyText(operation["x-oos-primary-caller"])) {
          fail(`missing x-oos-primary-caller for ${method.toUpperCase()} ${route}`);
        }
        if (!hasNonEmptyText(operation["x-oos-owner"])) {
          fail(`missing x-oos-owner for ${method.toUpperCase()} ${route}`);
        }
        if (!hasNonEmptyText(operation["x-oos-workflow-family"])) {
          fail(`missing x-oos-workflow-family for ${method.toUpperCase()} ${route}`);
        }
        const okStatus = Object.keys(operation.responses ?? {})
          .filter((status) => /^2[0-9][0-9]$/.test(status))
          .sort()[0];
        const okResponse = okStatus ? operation.responses[okStatus] : null;
        const jsonResponse = okResponse?.content?.["application/json"];
        if (!jsonResponse) {
          fail(`missing JSON success response documentation for ${method.toUpperCase()} ${route}`);
        }
        if (!responseHasExample(spec, jsonResponse)) {
          fail(`missing response example for ${method.toUpperCase()} ${route}`);
        }
        const responseExampleErrors = validateExampleAgainstMediaType(
          spec,
          jsonResponse,
          `${method.toUpperCase()} ${route} response`,
        );
        if (responseExampleErrors.length > 0) {
          fail(responseExampleErrors.join("\n"));
        }
        if (["post", "put", "patch"].includes(method)) {
          const requestBody = operation.requestBody;
          if (!requestBody || !jsonResponse) {
            fail(`missing JSON request body documentation for ${method.toUpperCase()} ${route}`);
          }
          const jsonBody = requestBody?.content?.["application/json"];
          if (!jsonBody) {
            fail(`missing JSON request body documentation for ${method.toUpperCase()} ${route}`);
          }
          if (!hasNonEmptyText(requestBody.description)) {
            fail(`missing request body description for ${method.toUpperCase()} ${route}`);
          }
          const hasNamedExamples =
            jsonBody.examples &&
            typeof jsonBody.examples === "object" &&
            Object.keys(jsonBody.examples).length > 0;
          const hasSingleExample = Object.hasOwn(jsonBody, "example");
          if (!hasNamedExamples && !hasSingleExample) {
            fail(`missing request example for ${method.toUpperCase()} ${route}`);
          }
          const requestExampleErrors = validateExampleAgainstMediaType(
            spec,
            jsonBody,
            `${method.toUpperCase()} ${route} request`,
          );
          if (requestExampleErrors.length > 0) {
            fail(requestExampleErrors.join("\n"));
          }
          if (jsonResponse.schema?.$ref === "#/components/schemas/GenericObjectResponse") {
            fail(`generic write response schema is not allowed for ${method.toUpperCase()} ${route}`);
          }
        }
      }
    }
  }

  return routes;
}

const openApiRaw = readFileSync(openApiPath, "utf8");
let spec;
try {
  spec = JSON.parse(openApiRaw);
} catch (error) {
  fail(`openapi.json is not valid JSON: ${error.message}`);
}

if (spec.openapi !== "3.1.0") {
  fail(`openapi.json must declare openapi 3.1.0, found ${spec.openapi ?? "missing"}`);
}

const redocHtml = readFileSync(redocPath, "utf8");
if (!redocHtml.includes("redoc.standalone.js")) {
  fail("docs/api/index.html does not load Redoc");
}
if (!redocHtml.includes("./openapi.json")) {
  fail("docs/api/index.html does not point Redoc at ./openapi.json");
}

const implementedRoutes = extractImplementedRoutes(readFileSync(appPath, "utf8"));
const documentedRoutes = extractDocumentedRoutes(spec);

requireNullableSchemaProperty(spec, "DeliveryInitiativeProjection", "pm2Phase");
requireNullableSchemaProperty(spec, "DeliveryInitiativeProjection", "targetPi");
requireNullableSchemaProperty(spec, "DeliveryWorkItemProjection", "assigneeLogin");
requireNullableSchemaProperty(spec, "DeliveryWorkItemProjection", "executionClassification");
requireNullableSchemaProperty(spec, "DeliveryWorkItemProjection", "targetPi");
requireNullableSchemaProperty(spec, "ParkingProjection", "review_date");
requireNullableSchemaProperty(spec, "DeliveryWorkItemMoveResponse", "note_applied");
requireNullableSchemaProperty(spec, "DeliveryWorkItemMoveResponse", "previous_parent_work_item_id");
requireNullableSchemaProperty(spec, "DeliveryWorkItemParkingResponse", "note_applied");
requireNullableSchemaProperty(spec, "DeliveryWorkItemCompleteResponse", "note_applied");
requireNullableSchemaProperty(spec, "DeliveryWorkItemStaleOpenCloseResponse", "note_applied");
requirePiObjectiveCreateSchema(spec);
requireOrchestrationCanonicalSchemas(spec);
requireProposalCanonicalSchemas(spec);
requireDeliveryIngressCanonicalSchemas(spec);
requireWorkDesignCanonicalSchemas(spec);
requireRefinementCanonicalSchemas(spec);
requireCatalogCanonicalSchemas(spec);
requireOrchestrationDefinitionSchema(spec);
requireOrchestrationGenerationCapacityResponse(spec);
requireControlledProofApiBoundary(spec);

const undocumented = [...implementedRoutes].filter(
  (route) => !documentedRoutes.has(route),
);
const staleDocs = [...documentedRoutes].filter(
  (route) => !implementedRoutes.has(route),
);

if (undocumented.length > 0) {
  fail(`implemented routes missing from docs/api/openapi.json: ${undocumented.join(", ")}`);
}

if (staleDocs.length > 0) {
  fail(`documented routes missing from src/app.js: ${staleDocs.join(", ")}`);
}

console.log(
  `api docs valid: documented_routes=${documentedRoutes.size} implemented_routes=${implementedRoutes.size}`,
);
