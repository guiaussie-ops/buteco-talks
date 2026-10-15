/**
 * A tecla do aperte-para-falar: qual é, como se chama na tela e quando ela
 * vale. Sem nada de React nem de áudio aqui — só a regra, para dar teste.
 *
 * A tecla é guardada pelo `code` do evento (a posição física no teclado) e não
 * pelo `key` (a letra que ela digita). Com `key`, segurar Shift transformava o
 * "v" em "V" e o PTT parava de responder no meio da frase.
 */

export type TeclaPtt = {
  /** `KeyboardEvent.code`, ou `Mouse3` / `Mouse4` para os botões laterais. */
  code: string;
  /** Como mostrar para a pessoa: o que a tecla digita no teclado DELA. */
  rotulo: string;
};

/** Crase/aspas, à esquerda do 1: longe do WASD e quase nunca usada no chat. */
export const TECLA_PTT_PADRAO: TeclaPtt = { code: "Backquote", rotulo: "'" };

/**
 * Soltar a tecla não corta na hora: o fim da última palavra costuma sair um
 * tiquinho depois do dedo. O Discord usa 20 ms, o TeamSpeak uns 300; 200 é o
 * meio que não come o "s" do fim e não deixa a mesa ouvir a respiração.
 */
export const ATRASO_PTT_PADRAO_MS = 200;
export const ATRASO_PTT_MAXIMO_MS = 1000;

/**
 * Teclas que escrevem alguma coisa. Com o foco numa caixa de texto elas são do
 * texto: apertar "'" no chat não pode abrir o microfone. As outras (F1–F12,
 * Ctrl, Alt, botões do mouse) não escrevem nada e valem até digitando.
 */
export function teclaDigitavel(code: string) {
  return (
    /^(Key[A-Z]|Digit\d|Numpad.+|Intl.+)$/.test(code) ||
    [
      "Space",
      "Backquote",
      "Minus",
      "Equal",
      "BracketLeft",
      "BracketRight",
      "Backslash",
      "Semicolon",
      "Quote",
      "Comma",
      "Period",
      "Slash",
      "Enter",
      "Backspace",
      "Tab",
    ].includes(code)
  );
}

/**
 * Teclas que não podem ser o PTT. Esc fecha diálogo; Tab anda pelo foco;
 * Enter e Espaço apertam o botão que estiver focado; CapsLock e companhia
 * trocam de estado a cada toque, e o `keyup` deles não é confiável.
 */
const PROIBIDAS = new Set([
  "Escape",
  "Tab",
  "Enter",
  "NumpadEnter",
  "Space",
  "Backspace",
  "CapsLock",
  "NumLock",
  "ScrollLock",
  "MetaLeft",
  "MetaRight",
]);

export function teclaPermitida(code: string) {
  return code !== "" && !PROIBIDAS.has(code);
}

/** Os botões laterais do mouse (voltar e avançar) viram tecla também. */
export function codeDoMouse(button: number): string | null {
  if (button === 3) return "Mouse3";
  if (button === 4) return "Mouse4";
  return null;
}

const ROTULOS: Record<string, string> = {
  Mouse3: "Mouse lateral (voltar)",
  Mouse4: "Mouse lateral (avançar)",
  ControlLeft: "Ctrl esquerdo",
  ControlRight: "Ctrl direito",
  AltLeft: "Alt",
  AltRight: "Alt Gr",
  ShiftLeft: "Shift esquerdo",
  ShiftRight: "Shift direito",
  Backquote: "'",
};

/**
 * Nome para a tela. O `key` do próprio evento é a melhor fonte para tecla de
 * letra, porque respeita o layout (ABNT2, US…); para as que não escrevem,
 * o `code` diz mais que um "Control".
 */
export function rotuloDaTecla(code: string, key?: string) {
  if (ROTULOS[code]) return ROTULOS[code];
  if (/^F\d{1,2}$/.test(code)) return code;
  if (key && key.length === 1 && key !== " ") return key.toUpperCase();
  return code.replace(/^Key|^Digit/, "");
}

/** Foco numa caixa de texto, onde tecla digitável é do texto. */
export function digitandoEm(alvo: EventTarget | null) {
  if (!alvo || typeof (alvo as HTMLElement).tagName !== "string") return false;
  const el = alvo as HTMLElement;
  if (el.isContentEditable) return true;
  if (el.tagName === "TEXTAREA" || el.tagName === "SELECT") return true;
  if (el.tagName !== "INPUT") return false;
  // Checkbox, range e botão não recebem texto: lá a tecla é do PTT.
  const tipo = (el as HTMLInputElement).type;
  return !["checkbox", "radio", "range", "button", "submit", "reset", "color", "file"].includes(
    tipo,
  );
}

/** A tecla apertada é o PTT e deve abrir o microfone? */
export function apertoValeParaPtt(code: string, tecla: TeclaPtt, alvo: EventTarget | null) {
  if (code !== tecla.code) return false;
  return !(teclaDigitavel(code) && digitandoEm(alvo));
}
