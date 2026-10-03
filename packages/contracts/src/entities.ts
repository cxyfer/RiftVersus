import { z } from "zod";

export const EntityKindSchema = z.enum(["player", "team", "region"]);

export const UuidSchema = z.uuid();
export const PublicIdSchema = z.string().min(1).max(256).regex(/^[^\s\p{Cc}]+$/u);

export const RouteSubjectRefSchema = z.object({
  kind: EntityKindSchema,
  id: PublicIdSchema,
  teamEraId: PublicIdSchema.optional(),
}).superRefine((subject, context) => {
  if (subject.kind !== "team" && subject.teamEraId !== undefined) {
    context.addIssue({ code: "custom", message: "teamEraId is only valid for team subjects.", path: ["teamEraId"] });
  }
});

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
  publicId: PublicIdSchema.optional(),
  publicEraId: PublicIdSchema.optional(),
  displayName: z.string().min(1),
  realName: z.string().min(1).optional(),
  eraLabel: z.string().min(1).optional(),
  mediaUrl: PresentationImageUrlSchema.optional(),
});

export type EntityKind = z.infer<typeof EntityKindSchema>;
export type SubjectRef = z.infer<typeof SubjectRefSchema>;
export type RouteSubjectRef = z.infer<typeof RouteSubjectRefSchema>;
export type ResolvedSubject = z.infer<typeof ResolvedSubjectSchema>;
