import { loadConfig } from "../src/config.js";
import { createOpenProjectClient } from "../src/openproject-client.js";

function usage(exitCode = 1) {
  console.error(
    "usage: node scripts/show_delivery_art_assignables.mjs [--json]\n" +
      "Reads the live assignable principals for Workspace Delivery ART using the current OpenProject env.",
  );
  process.exit(exitCode);
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.includes("--help")) {
  usage(0);
}

const outputJson = args.includes("--json");
if (args.length > 1 || (args.length === 1 && !outputJson)) {
  usage();
}

const config = loadConfig(process.env).openProject;
const client = createOpenProjectClient({ config });

try {
  const result = await client.listDeliveryProjectAssignablePrincipals();
  if (outputJson) {
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  }

  console.log(
    `${result.project.name ?? "Workspace Delivery ART"} ` +
      `(${result.project.identifier ?? "unknown-project"})`,
  );
  console.log(`- project id: ${result.project.id}`);
  console.log(`- project ref: ${result.project.recordRef}`);
  console.log("");
  for (const principal of result.principals) {
    const login = principal.login ?? "_missing-login_";
    const name = principal.name ?? "_missing-name_";
    const type = principal.type ?? "_unknown-type_";
    const id = principal.id ?? "_unknown-id_";
    console.log(`- ${login} | ${name} | ${type} | id=${id}`);
  }
} catch (error) {
  fail(error.message);
}
