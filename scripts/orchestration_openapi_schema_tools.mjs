function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodePointerSegment(segment) {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function resolveLocalRef(root, ref) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) {
    throw new Error(`unsupported canonical schema ref: ${ref}`);
  }

  const resolved = ref
    .slice(2)
    .split("/")
    .map(decodePointerSegment)
    .reduce((cursor, segment) => cursor?.[segment], root);
  if (!resolved) {
    throw new Error(`unresolved canonical schema ref: ${ref}`);
  }
  return resolved;
}

function mergeProjectedSchemas(left, right) {
  const merged = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (!Object.hasOwn(merged, key)) {
      merged[key] = value;
      continue;
    }
    if (JSON.stringify(merged[key]) === JSON.stringify(value)) {
      continue;
    }
    if (isPlainObject(merged[key]) && isPlainObject(value)) {
      merged[key] = mergeProjectedSchemas(merged[key], value);
      continue;
    }
    throw new Error(`conflicting canonical allOf projection for ${key}`);
  }
  return merged;
}

function projectSchemaNode(value, canonicalRoot, componentName) {
  if (Array.isArray(value)) {
    return value.map((entry) =>
      projectSchemaNode(entry, canonicalRoot, componentName),
    );
  }
  if (!isPlainObject(value)) {
    return value;
  }

  if (Array.isArray(value.allOf)) {
    const siblings = { ...value };
    delete siblings.allOf;
    const projected = value.allOf.reduce((merged, branch) => {
      const branchSchema = branch.$ref
        ? mergeProjectedSchemas(
            resolveLocalRef(canonicalRoot, branch.$ref),
            Object.fromEntries(
              Object.entries(branch).filter(([key]) => key !== "$ref"),
            ),
          )
        : branch;
      return mergeProjectedSchemas(
        merged,
        projectSchemaNode(branchSchema, canonicalRoot, componentName),
      );
    }, {});
    return mergeProjectedSchemas(
      projected,
      projectSchemaNode(siblings, canonicalRoot, componentName),
    );
  }

  const projected = {};
  for (const [key, entry] of Object.entries(value)) {
    if (key === "$ref") {
      if (!entry.startsWith("#/")) {
        throw new Error(`unsupported canonical schema ref: ${entry}`);
      }
      projected.$ref =
        `#/components/schemas/${componentName}${entry.slice(1)}`;
      continue;
    }
    projected[key] = projectSchemaNode(entry, canonicalRoot, componentName);
  }
  return projected;
}

export function projectCanonicalSchemaForOpenApi({
  canonicalFilename,
  canonicalPath = `contracts/orchestration/${canonicalFilename}`,
  canonicalSchema,
  componentName,
  existingSchema = {},
}) {
  const sourceSchema = { ...canonicalSchema };
  delete sourceSchema.$schema;
  delete sourceSchema.$id;

  const projected = projectSchemaNode(
    sourceSchema,
    canonicalSchema,
    componentName,
  );
  projected["x-oos-canonical-schema"] = canonicalPath;

  for (const key of ["description", "example", "examples"]) {
    if (Object.hasOwn(existingSchema, key)) {
      projected[key] = existingSchema[key];
    }
  }

  return projected;
}

export const ORCHESTRATION_OPENAPI_SCHEMA_BINDINGS = [
  {
    canonicalFilename: "run-request.schema.json",
    componentName: "OrchestrationRunRequest",
  },
  {
    canonicalFilename: "run-control.schema.json",
    componentName: "OrchestrationRunControl",
  },
  {
    canonicalFilename: "run-projection.schema.json",
    componentName: "OrchestrationRunProjection",
  },
  {
    canonicalFilename: "controlled-proof-start-request.schema.json",
    componentName: "ControlledProofStartRequest",
  },
  {
    canonicalFilename: "controlled-proof-control-request.schema.json",
    componentName: "ControlledProofControlRequest",
  },
  {
    canonicalFilename: "controlled-proof-run-projection.schema.json",
    componentName: "ControlledProofRunProjection",
  },
  {
    canonicalFilename: "controlled-proof-owner-receipt.schema.json",
    componentName: "ControlledProofOwnerReceipt",
  },
];
