// Config própria dos testes, separada do vite.config.ts de propósito: aquela
// carrega TanStack Start, nitro e o resto do app, e nada disso é necessário
// para testar lógica pura. Aqui só entra o alias "@", igual ao do tsconfig.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
