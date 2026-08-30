/// <reference types="vite/client" />

/**
 * As variáveis do build declaradas uma a uma, de propósito.
 *
 * O tsconfig liga `noPropertyAccessFromIndexSignature`, então a assinatura de
 * índice de `ImportMetaEnv` só aceita acesso por colchete — e o `define` do Vite
 * substitui `import.meta.env.VITE_X` (com ponto), nunca `['VITE_X']`. A soma das
 * duas coisas fazia a chave sumir do bundle de produção sem erro nenhum: o app
 * subia e só quebrava no navegador, ao criar o cliente do Supabase.
 *
 * Declarando as chaves aqui, o acesso por ponto passa a ser propriedade real e
 * o valor volta a ser assado no build.
 */
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
