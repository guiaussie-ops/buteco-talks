import { describe, expect, it } from "vitest";
import { mobiliaDaMesa } from "./mobilia";

const ids = Array.from(
  { length: 60 },
  (_, i) => `5b1c0a4e-0000-4000-8000-${String(i).padStart(12, "0")}`,
);

describe("mobiliaDaMesa", () => {
  it("é sempre a mesma mesa para o mesmo id", () => {
    expect(mobiliaDaMesa(ids[0]!)).toEqual(mobiliaDaMesa(ids[0]!));
  });

  it("mistura os três tipos de tampo, mesmo com ids quase iguais", () => {
    const tampos = new Set(ids.map((id) => mobiliaDaMesa(id).tampo));
    expect(tampos).toEqual(new Set(["plastico", "formica-redonda", "formica-quadrada"]));
  });

  it("cada tampo tem as cadeiras e a torção que fazem sentido para ele", () => {
    for (const id of ids) {
      const m = mobiliaDaMesa(id);
      if (m.tampo === "plastico") {
        expect(m.cadeiras).toHaveLength(4);
        expect(Math.abs(m.giro)).toBeLessThanOrEqual(7);
        expect(m.cadeiras.every((c) => c !== "banqueta")).toBe(true);
      } else {
        expect(m.cadeiras.every((c) => c === "ferro" || c === "banqueta")).toBe(true);
        if (m.tampo === "formica-redonda") {
          expect(m.cadeiras).toHaveLength(5);
          expect(m.giro).toBe(0);
        } else {
          expect(m.cadeiras).toHaveLength(4);
          expect(Math.abs(m.giro)).toBeLessThanOrEqual(2);
        }
      }
    }
  });
});
