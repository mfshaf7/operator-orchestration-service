function findObjectEnd(source, objectStart) {
  let depth = 0;
  let escaped = false;
  let inString = false;
  for (let index = objectStart; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return index + 1;
      }
    }
  }
  throw new Error("unterminated OpenAPI component object");
}

function componentRange(source, componentName) {
  const marker = `      "${componentName}": {`;
  const start = source.indexOf(marker);
  if (start < 0) {
    return null;
  }
  const objectStart = source.indexOf("{", start + marker.length - 1);
  return { start, end: findObjectEnd(source, objectStart) };
}

function renderComponent(componentName, schema) {
  const lines = JSON.stringify(schema, null, 2).split("\n");
  return lines
    .map((line, index) =>
      index === 0
        ? `      "${componentName}": ${line}`
        : `      ${line}`,
    )
    .join("\n");
}

function pathRange(source, routePath) {
  const marker = `    ${JSON.stringify(routePath)}: {`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const objectStart = source.indexOf("{", start + marker.length - 1);
  return { start, end: findObjectEnd(source, objectStart) };
}

function renderPath(routePath, operation) {
  const lines = JSON.stringify(operation, null, 2).split("\n");
  return lines
    .map((line, index) =>
      index === 0 ? `    ${JSON.stringify(routePath)}: ${line}` : `    ${line}`,
    )
    .join("\n");
}

export function upsertOpenApiPath(source, routePath, operation) {
  const range = pathRange(source, routePath);
  if (range) {
    return `${source.slice(0, range.start)}${renderPath(routePath, operation)}${source.slice(range.end)}`;
  }
  const pathsMarker = '  "paths": {';
  const pathsStart = source.indexOf(pathsMarker);
  if (pathsStart < 0) throw new Error("OpenAPI paths object is missing");
  const objectStart = source.indexOf("{", pathsStart + pathsMarker.length - 1);
  const objectEnd = findObjectEnd(source, objectStart);
  const beforeClose = source.slice(0, objectEnd - 1).trimEnd();
  const separator = beforeClose.endsWith("{") ? "" : ",";
  return `${beforeClose}${separator}\n${renderPath(routePath, operation)}\n  ${source.slice(objectEnd - 1)}`;
}

export function upsertOpenApiComponent(source, componentName, schema) {
  const range = componentRange(source, componentName);
  if (range) {
    return `${source.slice(0, range.start)}${renderComponent(componentName, schema)}${source.slice(range.end)}`;
  }

  const schemasMarker = '    "schemas": {';
  const schemasStart = source.indexOf(schemasMarker);
  if (schemasStart < 0) {
    throw new Error("OpenAPI components.schemas object is missing");
  }
  const objectStart = source.indexOf("{", schemasStart + schemasMarker.length - 1);
  const objectEnd = findObjectEnd(source, objectStart);
  const beforeClose = source.slice(0, objectEnd - 1).trimEnd();
  const separator = beforeClose.endsWith("{") ? "" : ",";

  return `${beforeClose}${separator}\n${renderComponent(componentName, schema)}\n    ${source.slice(objectEnd - 1)}`;
}

export function removeOpenApiComponent(source, componentName) {
  const range = componentRange(source, componentName);
  if (!range) {
    return source;
  }
  let removalEnd = range.end;
  if (source[removalEnd] === ",") {
    removalEnd += 1;
  }
  if (source[removalEnd] === "\n") {
    removalEnd += 1;
  }
  return `${source.slice(0, range.start)}${source.slice(removalEnd)}`;
}
