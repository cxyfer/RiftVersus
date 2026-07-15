import { z } from "zod";

export const EntityKindSchema = z.enum(["player", "team", "region"]);

export const UuidSchema = z.uuid();

export const PresentationImageUrlSchema = z.string().min(1).describe(
  "Same-origin presentation image URL for retained media or a canonical generated avatar.",
);

export const SubjectRefSchema = z
  .object({
    kind: EntityKindSchema,
    id: UuidSchema,
    teamEraId: UuidSchema.optional(),
  })
  .superRefine((subject, context) => {
    if (subject.kind !== "team" && subject.teamEraId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "teamEraId is only valid for team subjects.",
        path: ["teamEraId"],
      });
    }
  });

export const ResolvedSubjectSchema = SubjectRefSchema.extend({
  displayName: z.string().min(1),
  eraLabel: z.string().min(1).optional(),
  mediaUrl: PresentationImageUrlSchema.optional(),
});

export type EntityKind = z.infer<typeof EntityKindSchema>;
export type SubjectRef = z.infer<typeof SubjectRefSchema>;
export type ResolvedSubject = z.infer<typeof ResolvedSubjectSchema>;
