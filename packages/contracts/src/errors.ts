import { z } from "zod";

import { UuidSchema } from "./entities.js";

export const ApiErrorSchema = z.object({
  error: z.object({
    code: z.string().min(1),
    message: z.string().min(1),
    correlationId: UuidSchema.optional(),
  }),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
