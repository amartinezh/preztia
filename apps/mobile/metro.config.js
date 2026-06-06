// Metro para monorepo pnpm + NativeWind (iOS / Android / web).
const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");
const path = require("path");

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, "../..");

const config = getDefaultConfig(projectRoot);

// 1. Observar toda la raíz del monorepo (para ver cambios en packages/*).
config.watchFolders = [monorepoRoot];

// 2. Resolver módulos desde el node_modules de la app y el de la raíz (hoisted).
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];

module.exports = withNativeWind(config, { input: "./src/global.css" });
