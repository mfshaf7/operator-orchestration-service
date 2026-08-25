import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import { HttpError } from "../errors.js";

const contractRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../contracts/catalog",
);

const schemaFilenames = [
  "repository-readiness-reference.schema.json",
  "projection-result.schema.json",
  "mutation-request.schema.json",
  "mutation-result.schema.json",
  "error.schema.json",
];

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

const schemas = new Map(
  schemaFilenames.map((filename) => [
    filename,
    JSON.parse(readFileSync(path.join(contractRoot, filename), "utf8")),
  ]),
);
for (const schema of schemas.values()) {
  ajv.addSchema(schema);
}
const validators = new Map(
  [...schemas].map(([filename, schema]) => [filename, ajv.getSchema(schema.$id)]),
);

function validationDetails(validate) {
  return (validate.errors ?? []).map((error) => ({
    keyword: error.keyword,
    message: error.message,
    path: error.instancePath || "/",
  }));
}

export function assertCatalogContract(filename, value, label) {
  const validate = validators.get(filename);
  if (!validate) {
    throw new Error(`Unknown Catalog contract: ${filename}`);
  }
  if (!validate(value)) {
    throw new HttpError(
      400,
      "catalog_contract_invalid",
      `${label} does not satisfy the Catalog contract.`,
      validationDetails(validate),
    );
  }
  return value;
}

export function assertRepositoryReadinessReference(value) {
  const reference = assertCatalogContract(
    "repository-readiness-reference.schema.json",
    value,
    "Repository readiness reference",
  );
  if (
    reference.repo_ref !== `repo://${reference.repo_name}` ||
    reference.receipt.target_scope !== `repo:${reference.repo_name}` ||
    reference.catalog_value_key !== reference.repo_name
  ) {
    throw new HttpError(
      400,
      "repository_readiness_identity_mismatch",
      "Repository readiness identity, scope, and Catalog value must refer to the same admitted repository.",
    );
  }
  return reference;
}

export function assertCatalogProjectionResult(value) {
  const projection = assertCatalogContract(
    "projection-result.schema.json",
    value,
    "Catalog projection result",
  );
  for (const item of projection.values) {
    if (item.repository_binding) {
      assertRepositoryReadinessReference(item.repository_binding);
    }
  }
  const itemIds = new Set(projection.items.map((item) => item.catalog_item_id));
  const groupedItemIds = projection.groups.flatMap((group) => group.item_ids);
  const unknownGroupedItems = groupedItemIds.filter((itemId) => !itemIds.has(itemId));
  const ungroupedItems = [...itemIds].filter(
    (itemId) => !groupedItemIds.includes(itemId),
  );
  const orphanValues = projection.values.filter(
    (item) => !itemIds.has(item.catalog_item_id),
  );
  const expectedSummary = {
    total_items: projection.items.length,
    requestable_count: projection.items.filter(
      (item) => item.console_capability === "request",
    ).length,
    owner_routed_count: projection.items.filter(
      (item) => item.console_capability === "owner_routed",
    ).length,
    missing_route_count: projection.items.filter(
      (item) => item.gap_status === "missing_backend_route",
    ).length,
    drift_count: projection.items.filter((item) =>
      ["projection_drift", "stale_projection"].includes(item.gap_status),
    ).length,
  };
  if (
    new Set(groupedItemIds).size !== groupedItemIds.length ||
    unknownGroupedItems.length > 0 ||
    ungroupedItems.length > 0 ||
    orphanValues.length > 0 ||
    Object.entries(expectedSummary).some(
      ([key, expected]) => projection.summary[key] !== expected,
    )
  ) {
    throw new HttpError(
      400,
      "catalog_projection_incoherent",
      "Catalog groups, values, and summary counts must match the projected Catalog items.",
    );
  }
  return projection;
}

export function assertCatalogMutationRequest(value) {
  const request = assertCatalogContract(
    "mutation-request.schema.json",
    value,
    "Catalog mutation request",
  );
  if (request.acceptance.accepted_by !== request.operator.id) {
    throw new HttpError(
      400,
      "catalog_operator_acceptance_mismatch",
      "Catalog mutation acceptance must be recorded by the requesting operator.",
    );
  }
  if (request.draft.repository_binding) {
    assertRepositoryReadinessReference(request.draft.repository_binding);
  }
  return request;
}

export function assertCatalogMutationResult(value) {
  const result = assertCatalogContract(
    "mutation-result.schema.json",
    value,
    "Catalog mutation result",
  );
  if (result.value.repository_binding) {
    assertRepositoryReadinessReference(result.value.repository_binding);
  }
  for (const item of result.related_values) {
    if (item.repository_binding) {
      assertRepositoryReadinessReference(item.repository_binding);
    }
  }
  return result;
}

export function assertCatalogError(value) {
  return assertCatalogContract(
    "error.schema.json",
    value,
    "Catalog error",
  );
}
