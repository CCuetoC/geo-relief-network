import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const suite = process.argv[2] ?? "all";

if (!["all", "unit", "integration"].includes(suite)) {
  console.error("Uso: node scripts/run-node-tests.mjs [all|unit|integration]");
  process.exit(2);
}

const integrationUrl = process.env.GRN_TEST_DATABASE_URL;
if (suite !== "unit") {
  if (!integrationUrl) {
    console.error("Falta GRN_TEST_DATABASE_URL. Las pruebas de integración requieren una URL explícita de una rama Neon descartable.");
    process.exit(2);
  }

  let target;
  try {
    target = new URL(integrationUrl);
  } catch {
    console.error("GRN_TEST_DATABASE_URL no es una URL válida.");
    process.exit(2);
  }

  if (!target.hostname.endsWith(".neon.tech")) {
    console.error("Las pruebas de integración solo aceptan una URL de Neon.");
    process.exit(2);
  }

  if (integrationUrl === process.env.DATABASE_URL || integrationUrl === process.env.DATABASE_URL_UNPOOLED) {
    console.error("GRN_TEST_DATABASE_URL coincide con una URL de aplicación; se cancela para proteger las bases compartidas.");
    process.exit(2);
  }
}

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collectTestFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".test.ts")) files.push(path);
  }
  return files.sort();
}

const categories = suite === "all" ? ["unit", "integration"] : [suite];
const files = [];
for (const category of categories) {
  const directory = resolve(projectRoot, "tests", category);
  files.push(...await collectTestFiles(directory));
}

if (files.length === 0) {
  console.error(`No se encontraron archivos .test.ts para la suite ${suite}.`);
  process.exit(2);
}

const childEnv = { ...process.env, TSX_TSCONFIG_PATH: resolve(projectRoot, "tsconfig.test.json") };
if (suite !== "unit") {
  // The normal .env.local file is deliberately not loaded by this launcher.
  childEnv.DATABASE_URL = integrationUrl;
  childEnv.DATABASE_URL_UNPOOLED = integrationUrl;
}

const result = spawnSync(process.execPath, ["--import=tsx", "--test", ...files], {
  cwd: projectRoot,
  env: childEnv,
  stdio: "inherit",
});

if (result.error) {
  console.error(`No se pudo iniciar node:test: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
