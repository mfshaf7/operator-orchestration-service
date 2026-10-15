import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { upsertOpenApiComponent, upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
import {
  projectCanonicalSchemaForOpenApi,
} from "./orchestration_openapi_schema_tools.mjs";
import {
  PROPOSAL_OPENAPI_SCHEMA_BINDINGS,
} from "./proposal_openapi_schema_tools.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
const contractRoot = path.join(repoRoot, "contracts", "proposal-workflow");
const externalRefMap = Object.fromEntries(
  PROPOSAL_OPENAPI_SCHEMA_BINDINGS.flatMap(
    ({ canonicalFilename, componentName }) => {
      const schema = JSON.parse(
        readFileSync(path.join(contractRoot, canonicalFilename), "utf8"),
      );
      return [
        [canonicalFilename, componentName],
        [schema.$id, componentName],
      ];
    },
  ),
);

const original = readFileSync(openApiPath, "utf8");
const spec = JSON.parse(original);
let synchronized = original;

for (const { canonicalFilename, componentName } of
  PROPOSAL_OPENAPI_SCHEMA_BINDINGS) {
  const canonicalSchema = JSON.parse(
    readFileSync(path.join(contractRoot, canonicalFilename), "utf8"),
  );
  const projected = projectCanonicalSchemaForOpenApi({
    canonicalFilename,
    canonicalPath: `contracts/proposal-workflow/${canonicalFilename}`,
    canonicalSchema,
    componentName,
    externalRefMap,
    existingSchema: spec.components.schemas[componentName],
  });
  synchronized = upsertOpenApiComponent(
    synchronized,
    componentName,
    projected,
  );
}

const resolutionPath = structuredClone(spec.paths["/v1/proposals/{proposal_id}/commands"]);
const resolutionExample = JSON.parse(readFileSync(path.join(contractRoot, "repository-resolution.schema.json"), "utf8")).example;
resolutionPath.post.operationId = "resolveProposalRepositoryGate";
resolutionPath.post.summary = "Resolve a pending Proposal Repository gate from successful custody evidence";
resolutionPath.post.description = "Console-only, caller-bound resolution consumes the exact successful retained Repository custody receipt. It preserves Disposition, applies optimistic source guards, journals an immutable typed resolution, and supports same-request replay and interrupted acknowledgement recovery. It does not admit inventory or apply the downstream handoff.";
resolutionPath.post["x-oos-primary-caller"] = "governance-operations-console";
resolutionPath.post.requestBody = { required: true, description: "Current accepted Proposal source, exact successful custody receipt, and operator-reviewed resolution notes. Retain identical inputs for interrupted acknowledgement replay.", content: { "application/json": { schema: { $ref: "#/components/schemas/ProposalRepositoryResolutionV1" }, example: resolutionExample } } };
synchronized = upsertOpenApiPath(synchronized, "/v1/proposals/{proposal_id}/repository-resolution", resolutionPath);

if (process.argv.includes("--check")) {
  if (synchronized !== original) {
    console.error(
      "ERROR: Proposal OpenAPI schemas are not synchronized; run npm run sync:proposal-openapi-schemas",
    );
    process.exit(1);
  }
  console.log("Proposal OpenAPI schemas are synchronized");
} else {
  writeFileSync(openApiPath, synchronized, "utf8");
  console.log("synchronized Proposal OpenAPI schemas");
}
