import { describe, expect, it } from "vitest";
import { allocatePublicIds, normalizePublicId } from "../src/public-id.js";

describe("persistent public ID allocation", () => {
  it("normalizes without dropping Unicode or punctuation", () => {
    expect(normalizePublicId(" Ｆaker ")).toBe("faker");
    expect(normalizePublicId("Gen.G")).toBe("gen.g");
    expect(normalizePublicId("電競 戰隊")).toBe("電競-戰隊");
  });
  it("disambiguates existing same-kind names and preserves namespaces", () => {
    const assignments = allocatePublicIds([
      { id: "a", namespace: "player", label: "Benny", disambiguator: "Benny Hung" },
      { id: "b", namespace: "player", label: "Benny", disambiguator: "Lien Hsiu-Chi" },
      { id: "c", namespace: "team", label: "Benny" },
    ]);
    expect(assignments.map(item => item.publicId)).toEqual(["benny--benny-hung", "benny--lien-hsiu-chi", "benny"]);
  });
  it("keeps published IDs when new collisions arrive or labels change", () => {
    const initial = allocatePublicIds([{ id: "a", namespace: "player", label: "Faker" }]);
    expect(allocatePublicIds([
      { id: "a", namespace: "player", label: "New ID" },
      { id: "b", namespace: "player", label: "Faker", disambiguator: "Other Person" },
    ], initial).map(item => item.publicId)).toEqual(["faker", "faker--other-person"]);
  });
  it("extends colliding identity prefixes deterministically", () => {
    const input = ["12345678aaaa", "12345678bbbb"].map(id => ({ id, namespace: "player", label: "Same" }));
    const forward = allocatePublicIds(input);
    const reverse = allocatePublicIds([...input].reverse());
    expect(forward).toEqual([...reverse].reverse());
    expect(new Set(forward.map(item => item.publicId)).size).toBe(2);
  });
  it("reserves UUID-shaped keys for legacy routes and rejects namespace changes", () => {
    const assignments = allocatePublicIds([{ id: "12345678aaaa", namespace: "player", label: "11111111-1111-4111-8111-111111111111" }]);
    expect(assignments[0]!.publicId).toBe("11111111-1111-4111-8111-111111111111--12345678");
    expect(() => allocatePublicIds([{ id: "12345678aaaa", namespace: "team", label: "Other" }], assignments)).toThrow(/namespace is immutable/);
  });
});
