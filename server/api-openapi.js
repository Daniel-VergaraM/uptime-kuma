/**
 * OpenAPI 3 description of the REST API under /api/v1.
 * Served at GET /api/v1/openapi.json.
 */
const idParam = { name: "id", in: "path", required: true, schema: { type: "integer" } };
const jsonResponse = (description) => ({
    description,
    content: { "application/json": { schema: { type: "object" } } },
});
const errorResponse = {
    description: "Error",
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
};

const openApiSpec = {
    openapi: "3.0.3",
    info: {
        title: "Uptime Kuma API",
        version: "1",
        description:
            "Manage monitors, read checks and analytics, and back up configuration. " +
            "Create an API key in Settings > API Keys and send it as `Authorization: Bearer <key>` " +
            "(or as the password in Basic auth). Every request is scoped to the key's owner. " +
            "A read-only key can read but gets 403 on any change. Each key may make 60 requests per minute (429 when over); " +
            "failed key attempts share a separate limit. Errors are JSON: { ok: false, msg }. Bad input gives 400, unknown ids 404, server faults 500.",
    },
    servers: [{ url: "/" }],
    security: [{ bearerAuth: [] }, { basicAuth: [] }],
    paths: {
        "/api/v1/monitors": {
            get: {
                summary: "List monitors",
                description:
                    "All monitors you own, oldest first. Filter with q (name contains), type and active. " +
                    "Page with limit (1 to 500) and offset. The response header X-Total-Count holds the number of matches.",
                parameters: [
                    { name: "q", in: "query", schema: { type: "string" } },
                    { name: "type", in: "query", schema: { type: "string" } },
                    { name: "active", in: "query", schema: { type: "boolean" } },
                    { name: "limit", in: "query", schema: { type: "integer", minimum: 1, maximum: 500 } },
                    { name: "offset", in: "query", schema: { type: "integer", minimum: 0, default: 0 } },
                ],
                responses: { 200: jsonResponse("Array of monitors"), 400: errorResponse, 401: errorResponse },
            },
            post: {
                summary: "Create a monitor",
                description:
                    "Body uses the same field names as the monitor form. Only `name` is required; `type` defaults to `http`. " +
                    "`sloTarget` (0 to 100, e.g. 99.9) sets an availability goal used for the error budget. " +
                    'Example: `{"name":"Website","type":"http","url":"https://example.com","interval":60}`.',
                requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
                responses: { 201: jsonResponse("The created monitor"), 400: errorResponse, 401: errorResponse },
            },
        },
        "/api/v1/monitors/bulk": {
            post: {
                summary: "Change many monitors at once",
                description:
                    "Body: { monitorIDs: [1, 2], changes: { interval?: 60, parent?: groupID|null, addTag?: { tagID, value } } }. " +
                    "All monitors must be yours. Nothing changes if any check fails.",
                requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
                responses: { 200: jsonResponse("{ updated: [ids] }"), 400: errorResponse },
            },
        },
        "/api/v1/monitors/{id}": {
            parameters: [idParam],
            get: {
                summary: "Get a monitor",
                responses: { 200: jsonResponse("The monitor"), 404: errorResponse },
            },
            patch: {
                summary: "Update a monitor",
                description: "Send only the fields to change. Other fields keep their stored values.",
                requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
                responses: { 200: jsonResponse("The updated monitor"), 400: errorResponse, 404: errorResponse },
            },
            delete: {
                summary: "Delete a monitor",
                parameters: [
                    {
                        name: "deleteChildren",
                        in: "query",
                        required: false,
                        schema: { type: "boolean", default: false },
                        description: "For group monitors: also delete the children instead of unlinking them",
                    },
                ],
                responses: { 200: jsonResponse("Deleted"), 404: errorResponse },
            },
        },
        "/api/v1/monitors/{id}/pause": {
            parameters: [idParam],
            post: { summary: "Pause a monitor", responses: { 200: jsonResponse("Paused"), 404: errorResponse } },
        },
        "/api/v1/monitors/{id}/resume": {
            parameters: [idParam],
            post: { summary: "Resume a monitor", responses: { 200: jsonResponse("Resumed"), 404: errorResponse } },
        },
        "/api/v1/monitors/{id}/analytics": {
            parameters: [idParam],
            get: {
                summary: "Analytics for a monitor",
                description:
                    "Summary (uptime, ping percentiles, incidents, MTTR, MTBF), time series, incidents and certificate.",
                parameters: [
                    {
                        name: "period",
                        in: "query",
                        schema: { type: "integer", enum: [24, 168, 720, 2160, 8760], default: 24 },
                        description: "Period in hours",
                    },
                ],
                responses: { 200: jsonResponse("Analytics"), 400: errorResponse, 404: errorResponse },
            },
        },
        "/api/v1/monitors/{id}/heartbeats": {
            parameters: [idParam],
            get: {
                summary: "Raw checks for a monitor",
                description: "Status codes: 0 = down, 1 = up, 2 = pending, 3 = maintenance.",
                parameters: [
                    {
                        name: "hours",
                        in: "query",
                        schema: { type: "integer", minimum: 1, maximum: 8760, default: 24 },
                    },
                    {
                        name: "format",
                        in: "query",
                        schema: { type: "string", enum: ["json", "csv"], default: "json" },
                    },
                ],
                responses: { 200: jsonResponse("{ checks: [...] } or CSV"), 400: errorResponse, 404: errorResponse },
            },
        },
        "/api/v1/backup": {
            get: {
                summary: "Download a backup",
                description:
                    "Monitors, notifications and tags as JSON. Notification settings are included in plain text.",
                responses: { 200: jsonResponse("Backup file") },
            },
            post: {
                summary: "Restore a backup",
                description:
                    "Creates monitors, notifications, tags and status pages from a backup. Items with an existing name (or slug) are skipped. " +
                    "For an encrypted file, send its passphrase in the x-backup-passphrase header.",
                parameters: [
                    { name: "x-backup-passphrase", in: "header", required: false, schema: { type: "string" } },
                ],
                requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
                responses: { 200: jsonResponse("Counts of created and skipped items"), 400: errorResponse },
            },
        },
        "/api/v1/backup/export": {
            post: {
                summary: "Export an encrypted backup",
                description:
                    'Body: { "passphrase": "at least 8 characters" }. Returns the backup encrypted with AES-256-GCM. ' +
                    "Without a passphrase use GET /api/v1/backup. Keep the passphrase: the file cannot be restored without it.",
                requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
                responses: { 200: jsonResponse("Encrypted backup file"), 400: errorResponse },
            },
        },
        "/api/v1/openapi.json": {
            get: { summary: "This document", security: [], responses: { 200: jsonResponse("OpenAPI document") } },
        },
    },
    components: {
        securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer" },
            basicAuth: { type: "http", scheme: "basic", description: "Use the API key as the password" },
        },
        schemas: {
            Error: {
                type: "object",
                properties: { ok: { type: "boolean", example: false }, msg: { type: "string" } },
            },
        },
    },
};

module.exports = { openApiSpec };
