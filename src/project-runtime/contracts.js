import { readFileSync } from "node:fs";
import Ajv2020 from "ajv/dist/2020.js";

const schema = JSON.parse(readFileSync(new URL("../../contracts/project-runtime/source-snapshot.schema.json", import.meta.url), "utf8"));
const validator = new Ajv2020().addSchema(schema);
const definition = name => validator.compile({ $ref: `${schema.$id}#/$defs/${name}` });

export const projectSourceSnapshotSchema = {
  manifest: validator.getSchema(schema.$id),
  scope: definition("scope"),
  source: definition("source"),
  setup: definition("setup"),
  reference: definition("reference"),
};
