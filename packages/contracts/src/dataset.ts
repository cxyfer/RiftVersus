import { z } from "zod";

import { DateSchema } from "./primitives.js";

export const DatasetSchema = z.object({
  version: z.string().min(1),
  lastSuccessfulSyncAt: z.iso.datetime(),
  coverage: z.object({
    from: DateSchema,
    to: DateSchema,
  }),
});

export type Dataset = z.infer<typeof DatasetSchema>;
