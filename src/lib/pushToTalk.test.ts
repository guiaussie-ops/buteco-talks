import { describe, expect, it } from "vitest";
import {
  TECLA_PTT_PADRAO,
  apertoValeParaPtt,
  codeDoMouse,
  digitandoEm,
  rotuloDaTecla,
  teclaDigitavel,
  teclaPermitida,
} from "@/lib/pushToTalk";

/** O suficiente de um elemento para `digitandoEm`, sem precisar de DOM. */
const el = (tagName: string, extra: Record<string, unknown> = {}) =>
  ({ tagName, isContentEditable: false, ...extra }) as unknown as EventTarget;

describe("apertoValeParaPtt", () => {
  const tecla = { code: "KeyV", rotulo: "V" };

  it("abre com a tecla certa fora de caixa de texto", () => {
    expect(apertoValeParaPtt("KeyV", tecla, el("DIV"))).toBe(true);
    expect(apertoValeParaPtt("KeyV", tecla, null)).toBe(true);
  });

  it("ignora outra tecla", () => {
    expect(apertoValeParaPtt("KeyB", tecla, el("DIV"))).toBe(false);
  });

  it("não abre o microfone enquanto a pessoa digita a letra no chat", () => {
    expect(apertoValeParaPtt("KeyV", tecla, el("TEXTAREA"))).toBe(false);
    expect(apertoValeParaPtt("KeyV", tecla, el("INPUT", { type: "text" }))).toBe(false);
    expect(apertoValeParaPtt("KeyV", tecla, el("DIV", { isContentEditable: true }))).toBe(false);
  });

  it("tecla que não escreve vale até digitando", () => {
    const f8 = { code: "F8", rotulo: "F8" };
    expect(apertoValeParaPtt("F8", f8, el("TEXTAREA"))).toBe(true);
  });

  it("checkbox e slider não são caixa de texto", () => {
    expect(apertoValeParaPtt("KeyV", tecla, el("INPUT", { type: "checkbox" }))).toBe(true);
    expect(apertoValeParaPtt("KeyV", tecla, el("INPUT", { type: "range" }))).toBe(true);
  });
});

describe("teclas", () => {
  it("separa as que escrevem das que não escrevem", () => {
    expect(teclaDigitavel("KeyA")).toBe(true);
    expect(teclaDigitavel("Digit1")).toBe(true);
    expect(teclaDigitavel("Backquote")).toBe(true);
    expect(teclaDigitavel("IntlBackslash")).toBe(true);
    expect(teclaDigitavel("F1")).toBe(false);
    expect(teclaDigitavel("ControlRight")).toBe(false);
    expect(teclaDigitavel("Mouse4")).toBe(false);
  });

  it("recusa as teclas que já têm trabalho no navegador", () => {
    expect(teclaPermitida("Escape")).toBe(false);
    expect(teclaPermitida("Tab")).toBe(false);
    expect(teclaPermitida("Space")).toBe(false);
    expect(teclaPermitida("CapsLock")).toBe(false);
    expect(teclaPermitida("")).toBe(false);
    expect(teclaPermitida("KeyV")).toBe(true);
    expect(teclaPermitida("Mouse3")).toBe(true);
    expect(teclaPermitida(TECLA_PTT_PADRAO.code)).toBe(true);
  });

  it("só os botões laterais do mouse viram tecla", () => {
    expect(codeDoMouse(0)).toBeNull();
    expect(codeDoMouse(2)).toBeNull();
    expect(codeDoMouse(3)).toBe("Mouse3");
    expect(codeDoMouse(4)).toBe("Mouse4");
  });

  it("dá nome pelo layout da pessoa", () => {
    expect(rotuloDaTecla("KeyV", "v")).toBe("V");
    expect(rotuloDaTecla("Semicolon", "ç")).toBe("Ç");
    expect(rotuloDaTecla("F8", "F8")).toBe("F8");
    expect(rotuloDaTecla("ControlRight", "Control")).toBe("Ctrl direito");
    expect(rotuloDaTecla("Mouse4")).toBe("Mouse lateral (avançar)");
    expect(rotuloDaTecla("KeyQ")).toBe("Q");
  });

  it("sem elemento não é caixa de texto", () => {
    expect(digitandoEm(null)).toBe(false);
  });
});
