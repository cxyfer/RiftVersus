import { z } from "zod";

import { DatasetSchema } from "./dataset.js";
import { PresentationImageUrlSchema, ResolvedSubjectSchema, SubjectRefSchema, UuidSchema } from "./entities.js";
import { DateSchema } from "./primitives.js";

export { DateSchema } from "./primitives.js";

export const EventCategorySchema = z.enum(["league", "fst", "msi", "worlds", "other"]);
export const LeagueSlugSchema = z.enum(["lck", "lpl", "lec", "lcs"]);

export const BestOfSchema = z.preprocess(
  (value) => (typeof value === "string" ? Number(value) : value),
  z.union([z.literal(1), z.literal(3), z.literal(5)]),
);

export const OpaqueCursorSchema = z.string().min(1);

export const ComparisonQuerySchema = z
  .object({
    left: SubjectRefSchema,
    right: SubjectRefSchema,
    from: DateSchema.optional(),
    to: DateSchema.optional(),
    eventCategories: z.array(EventCategorySchema).default([]),
    leagues: z.array(LeagueSlugSchema).default([]),
    bestOf: z.array(BestOfSchema).default([]),
    tournamentIds: z.array(UuidSchema).default([]),
    cursor: OpaqueCursorSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .superRefine((query, context) => {
    if (query.left.id === query.right.id) {
      context.addIssue({
        code: "custom",
        message: "Comparison subjects must have distinct canonical IDs.",
        path: ["right", "id"],
      });
    }

    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      context.addIssue({
        code: "custom",
        message: "from must not be after to.",
        path: ["to"],
      });
    }
  });

export const RecordSummarySchema = z.object({
  wins: z.number().int().min(0),
  losses: z.number().int().min(0),
  total: z.number().int().min(0),
  winRate: z.number().min(0).max(1),
});

export const SeriesRowSchema = z.object({
  id: UuidSchema,
  date: DateSchema,
  event: z.object({
    id: UuidSchema,
    name: z.string().min(1),
    category: EventCategorySchema,
  }),
  bestOf: BestOfSchema,
  leftName: z.string().min(1),
  rightName: z.string().min(1),
  leftScore: z.number().int().min(0),
  rightScore: z.number().int().min(0),
  winner: z.enum(["left", "right"]),
});

export const CoverageWarningSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
});

export const ComparisonResponseSchema = z.object({
  subjects: z.object({
    left: ResolvedSubjectSchema,
    right: ResolvedSubjectSchema,
  }),
  query: ComparisonQuerySchema,
  seriesSummary: RecordSummarySchema,
  gameSummary: RecordSummarySchema,
  rows: z.array(SeriesRowSchema),
  nextCursor: OpaqueCursorSchema.optional(),
  dataset: DatasetSchema,
  coverageWarnings: z.array(CoverageWarningSchema),
  mediaUrls: z.object({
    left: PresentationImageUrlSchema,
    right: PresentationImageUrlSchema,
  }),
});

export type EventCategory = z.infer<typeof EventCategorySchema>;
export type LeagueSlug = z.infer<typeof LeagueSlugSchema>;
export type BestOf = z.infer<typeof BestOfSchema>;
export type ComparisonQuery = z.infer<typeof ComparisonQuerySchema>;
export type ComparisonResponse = z.infer<typeof ComparisonResponseSchema>;
