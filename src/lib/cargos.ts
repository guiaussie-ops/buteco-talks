/**
 * Cargos do buteco. O banco é quem decide (server_role_rank, definir_cargo,
 * expulsar); aqui ficam as mesmas regras só para a interface não oferecer um
 * botão que o banco vai recusar.
 */

export type Cargo = "owner" | "admin" | "moderador" | "member";

export const PESO: Record<Cargo, number> = { owner: 3, admin: 2, moderador: 1, member: 0 };

export const ROTULO: Record<Cargo, string> = {
  owner: "Dono",
  admin: "Admin",
  moderador: "Moderador",
  member: "Membro",
};

export const DESCRICAO: Record<Exclude<Cargo, "owner">, string> = {
  admin: "Mexe nas mesas e nos cargos abaixo dele, e bane",
  moderador: "Apaga mensagens dos outros e expulsa membros",
  member: "Senta, conversa e entra nas mesas de voz",
};

/** O dono é dono por servers.owner_id, mesmo que a linha diga outra coisa. */
export function cargoDe(role: string | undefined, userId: string, ownerId: string): Cargo {
  if (userId === ownerId) return "owner";
  return role === "admin" || role === "moderador" ? role : "member";
}

/** Cargos que `eu` pode dar a `alvo`: só abaixo do meu, e só a quem está abaixo de mim. */
export function cargosQuePossoDar(eu: Cargo, alvo: Cargo): Exclude<Cargo, "owner">[] {
  if (PESO[eu] < PESO.admin || PESO[alvo] >= PESO[eu]) return [];
  return (["admin", "moderador", "member"] as const).filter((c) => PESO[c] < PESO[eu]);
}

export function possoExpulsar(eu: Cargo, alvo: Cargo) {
  return PESO[eu] >= PESO.moderador && PESO[alvo] < PESO[eu];
}

export function possoBanir(eu: Cargo, alvo: Cargo) {
  return PESO[eu] >= PESO.admin && PESO[alvo] < PESO[eu];
}
