import { randomUUID } from "node:crypto";

import { ApiErrorSchema } from "@riftversus/contracts";
import type { FastifyReply } from "fastify";
import { ZodError } from "zod";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function validationError(error: ZodError) {
  return new ApiError(400, "VALIDATION_ERROR", error.issues[0]?.message ?? "Invalid request.");
}

export function notFoundError() {
  return new ApiError(404, "NOT_FOUND", "The requested resource was not found.");
}

export function notReadyError() {
  return new ApiError(503, "NOT_READY", "The service is not ready.");
}

export function isMissingSubjectError(error: unknown) {
  return error instanceof Error && (
    /^Unknown (player|team|region) subject: /.test(error.message)
    || error.message === "Team era does not belong to the selected team."
  );
}

export function sendApiError(reply: FastifyReply, error: unknown) {
  if (error instanceof ApiError) {
    return reply.status(error.statusCode).send(ApiErrorSchema.parse({ error: { code: error.code, message: error.message } }));
  }

  const correlationId = randomUUID();
  return reply.status(500).send(ApiErrorSchema.parse({
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred.", correlationId },
  }));
}
