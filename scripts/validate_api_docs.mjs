import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  responseHasExample,
  validateExampleAgainstMediaType,
} from "./api_contract_tools.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const openApiPath = path.join(repoRoot, "docs", "api", "openapi.json");
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

function normalizeRegexRoute(literal) {
  const trimmed = literal.trim();
  if (!trimmed.startsWith("/^") || !trimmed.endsWith("$/")) {
    fail(`unsupported route regex literal: ${literal}`);
  }

  const pattern = trimmed.slice(2, -2).replaceAll("\\/", "/");
  if (pattern.startsWith("/v1/ideas/")) {
    return pattern.replace("[^/]+", "{idea_id}");
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

  fail(`unsupported route regex family: ${literal}`);
}

function extractImplementedRoutes(appSource) {
  const routes = new Set();

  const exactRoutePattern =
    /request\.method === "([A-Z]+)"\s*&&\s*url\.pathname === "([^"]+)"/gms;
  for (const match of appSource.matchAll(exactRoutePattern)) {
    const [, method, route] = match;
    routes.add(`${method} ${route}`);
  }

  const regexRoutePattern =
    /request\.method === "([A-Z]+)"\s*&&\s*(\/\^[\s\S]*?\$\/)\.test\(url\.pathname\)/gms;
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
        const okResponse = operation.responses?.["200"];
        const jsonResponse = okResponse?.content?.["application/json"];
        if (!jsonResponse) {
          fail(`missing JSON 200 response documentation for ${method.toUpperCase()} ${route}`);
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
