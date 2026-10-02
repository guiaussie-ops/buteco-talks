import { describe, expect, it } from "vitest";
import { cargoDe, cargosQuePossoDar, possoBanir, possoExpulsar } from "@/lib/cargos";

describe("cargoDe", () => {
  it("o dono é dono pelo servers.owner_id, diga a linha o que disser", () => {
    expect(cargoDe("member", "zé", "zé")).toBe("owner");
  });

  it("valor desconhecido vira membro, nunca cargo maior", () => {
    expect(cargoDe("superadmin", "ana", "zé")).toBe("member");
    expect(cargoDe(undefined, "ana", "zé")).toBe("member");
    expect(cargoDe("moderador", "ana", "zé")).toBe("moderador");
  });
});

describe("quem mexe em quem (espelho das regras do banco)", () => {
  it("dono promove até admin; admin promove até moderador; abaixo disso ninguém", () => {
    expect(cargosQuePossoDar("owner", "member")).toEqual(["admin", "moderador", "member"]);
    expect(cargosQuePossoDar("admin", "member")).toEqual(["moderador", "member"]);
    expect(cargosQuePossoDar("moderador", "member")).toEqual([]);
  });

  it("ninguém mexe em quem pesa igual ou mais", () => {
    expect(cargosQuePossoDar("admin", "admin")).toEqual([]);
    expect(cargosQuePossoDar("admin", "owner")).toEqual([]);
    expect(possoExpulsar("moderador", "moderador")).toBe(false);
    expect(possoBanir("admin", "admin")).toBe(false);
  });

  it("moderador expulsa membro mas não bane; admin bane", () => {
    expect(possoExpulsar("moderador", "member")).toBe(true);
    expect(possoBanir("moderador", "member")).toBe(false);
    expect(possoBanir("admin", "moderador")).toBe(true);
    expect(possoExpulsar("member", "member")).toBe(false);
  });
});
