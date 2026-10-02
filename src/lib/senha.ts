/**
 * Regra de senha do app, a MESMA configurada no painel do Supabase
 * (Authentication → Attack Protection): pelo menos 8 caracteres, com letra e
 * número. Conferir aqui antes de mandar é o que dá a mensagem em português —
 * a recusa do Supabase vem em inglês.
 *
 * Vale só para senha nova (cadastro e troca). Quem já tinha uma senha mais
 * curta continua entrando com ela.
 */
export const SENHA_MINIMA = 8;

export const REGRA_DA_SENHA = `Pelo menos ${SENHA_MINIMA} caracteres, com letra e número.`;

/** O que falta na senha, em português, ou null se ela passa. */
export function problemaDaSenha(senha: string): string | null {
  if (senha.length < SENHA_MINIMA)
    return `A senha precisa de pelo menos ${SENHA_MINIMA} caracteres.`;
  if (!/\p{L}/u.test(senha)) return "A senha precisa de pelo menos uma letra.";
  if (!/\p{N}/u.test(senha)) return "A senha precisa de pelo menos um número.";
  return null;
}

/** Traduz a recusa de senha fraca do Supabase; outros erros passam como estão. */
export function mensagemDeErroDaSenha(mensagem: string): string {
  if (/password/i.test(mensagem) && /(short|weak|should|characters|contain)/i.test(mensagem)) {
    return `Senha fraca. ${REGRA_DA_SENHA}`;
  }
  return mensagem;
}
