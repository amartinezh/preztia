// Refuerza la regla de dependencia hexagonal:
// domain  ⟵ application ⟵ infrastructure/apps   (nunca al revés)
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  plugins: ["@typescript-eslint", "import"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  settings: { "import/resolver": { typescript: true } },
  rules: {
    "import/no-restricted-paths": ["error", {
      zones: [
        // El dominio no puede importar de aplicación ni de infraestructura
        { target: "./packages/domain", from: "./packages/application" },
        { target: "./packages/domain", from: "./apps" },
        // La aplicación no puede importar de las apps (infraestructura)
        { target: "./packages/application", from: "./apps" }
      ]
    }]
  }
};
