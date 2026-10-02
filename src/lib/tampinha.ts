/**
 * Cor determinística por apelido — cada pessoa tem sua tampinha, e a mesma cor
 * aparece em todo lugar onde ela está: no avatar, nas bolinhas em volta da
 * miniatura da mesa e na planta do salão.
 */
export function hueFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}

export function corDaTampinha(name: string) {
  const hue = hueFor(name || "?");
  return { cap: `oklch(0.66 0.14 ${hue})`, capDark: `oklch(0.46 0.12 ${hue})` };
}
