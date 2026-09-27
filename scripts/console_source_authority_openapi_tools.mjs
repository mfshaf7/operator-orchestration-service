export const CONSOLE_SOURCE_PROJECTION_MEDIA_TYPE =
  "application/vnd.mfshaf7.console-source-projection+json";

export const CONSOLE_SOURCE_PROJECTION_COMPONENT =
  "ConsoleSourceProjectionV1";

export function addConsoleSourceProjectionMedia(pathItem, method) {
  const operation = pathItem[method];
  const successResponse = operation?.responses?.["200"];
  if (!successResponse?.content?.["application/json"]) {
    throw new Error(
      `Console source projection route ${method.toUpperCase()} must expose a 200 application/json response`,
    );
  }

  return {
    ...pathItem,
    [method]: {
      ...operation,
      responses: {
        ...operation.responses,
        200: {
          ...successResponse,
          content: {
            [CONSOLE_SOURCE_PROJECTION_MEDIA_TYPE]: {
              schema: {
                $ref: `#/components/schemas/${CONSOLE_SOURCE_PROJECTION_COMPONENT}`,
              },
            },
            ...successResponse.content,
          },
        },
        406: {
          description: "The requested Console source projection version is not supported.",
          content: {
            "application/json": {
              schema: {
                type: "object",
                additionalProperties: false,
                required: ["error", "message", "details"],
                properties: {
                  error: {
                    const: "source_projection_version_not_acceptable",
                  },
                  message: { type: "string", minLength: 1 },
                  details: { type: "null" },
                },
              },
            },
          },
        },
      },
    },
  };
}

export const CONSOLE_SOURCE_RESPONSE_MEDIA_RETENTION = {
  retainResponseMediaTypes: [CONSOLE_SOURCE_PROJECTION_MEDIA_TYPE],
  retainResponseStatuses: ["406"],
};

export function upsertConsoleCompatibleOpenApiPath(
  source,
  routePath,
  pathItem,
) {
  return upsertOpenApiPath(
    source,
    routePath,
    pathItem,
    CONSOLE_SOURCE_RESPONSE_MEDIA_RETENTION,
  );
}
import { upsertOpenApiPath } from "./openapi_component_sync_tools.mjs";
