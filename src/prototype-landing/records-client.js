import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { parse as parseYaml } from "yaml";
import { assertProposalTargetArtifact, proposalTargetDigest } from "../proposal-target-application/contracts.js";
import { prototypeLandingError } from "./contracts.js";

const ROOTS = [
  "records/prototype-captures/", "records/prototype-landings/",
  "records/prototype-maturity/", "records/prototype-closure/",
  "records/design-baselines/", "records/delivery-packets/",
  "records/prototype-preview-profiles/", "records/graduations/",
];

// Immutable Git reads only. The provider revision must already be available in
// the deployment-owned trusted ref; neither this reader nor WGCF fetches Git.
export async function readPrototypeRecords({ git, authorityRoot, revision, minimumRevision }) {
  try {
    if (!/^[0-9a-f]{40}$/.test(revision)) throw new Error("invalid revision");
    await git(authorityRoot, "merge-base", "--is-ancestor", minimumRevision, revision);
    await git(authorityRoot, "merge-base", "--is-ancestor", revision, "refs/remotes/origin/main");
    const files = (await git(authorityRoot, "ls-tree", "-r", "-z", revision, "--", "prototypes.yaml", "schemas/prototype-registry.schema.json", ...ROOTS))
      .split("\0").filter(Boolean).map((line) => {
        const match = /^(100644) blob [0-9a-f]{40}\t([^\0]+)$/.exec(line);
        if (!match) throw new Error("non-regular owner record");
        return match[2];
      }).filter((name) => /\.(?:json|yaml)$/.test(name));
    if (files.length > 512 || !files.includes("prototypes.yaml") || !files.includes("schemas/prototype-registry.schema.json")) {
      throw new Error("missing or oversized registry");
    }
    let total = 0;
    const documents = {};
    for (const name of files.sort()) {
      const raw = await git(authorityRoot, "show", `${revision}:${name}`);
      total += Buffer.byteLength(raw);
      if (Buffer.byteLength(raw) > 262144 || total > 2 * 1024 * 1024) throw new Error("owner records exceed limit");
      documents[name] = name.endsWith(".json") ? JSON.parse(raw) : parseYaml(raw, { maxAliasCount: 0, uniqueKeys: true });
      if (!documents[name] || Array.isArray(documents[name]) || typeof documents[name] !== "object") throw new Error("invalid owner record document");
    }
    const registry = documents["prototypes.yaml"];
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    addFormats(ajv);
    const validate = ajv.compile(documents["schemas/prototype-registry.schema.json"]);
    if (!validate(registry)) throw new Error("invalid owner registry");
    const ids = registry.prototypes.map((record) => record.id);
    if (new Set(ids).size !== ids.length) throw new Error("duplicate Prototype identity");
    const captures = [];
    for (const [name, value] of Object.entries(documents)) {
      if (!/^records\/prototype-captures\/[^/]+\/record\.json$/.test(name)) continue;
      const capture = assertProposalTargetArtifact(value);
      const slug = capture.record_ref.slice("record://prototype-captures/".length);
      if (name !== `records/prototype-captures/${slug}/record.json` || capture.prototype_id !== `prototype:${slug}` ||
          capture.entry_packet.entry_id !== `prototype-entry:proposal-routed:${slug}` ||
          capture.entry_packet.source.ref !== capture.proposal.record_ref ||
          capture.entry_packet.source.revision !== capture.proposal.record_version ||
          capture.entry_packet.source.digest !== capture.proposal.handoff_packet_digest ||
          capture.entry_packet.packet_digest !== proposalTargetDigest(capture.entry_packet, "packet_digest")) throw new Error("capture path identity or digest mismatch");
      captures.push(capture);
    }
    delete documents["prototypes.yaml"];
    delete documents["schemas/prototype-registry.schema.json"];
    const sequence = Number(await git(authorityRoot, "rev-list", "--count", revision));
    if (!Number.isSafeInteger(sequence) || sequence < 1) throw new Error("invalid source sequence");
    return {
      schema_version: 1, workflow_id: "prototype-records",
      authority_revision: revision, authority_sequence: sequence,
      registry, captures, documents, canonical_mutation: false,
    };
  } catch {
    throw prototypeLandingError("records_unavailable", "Current canonical Prototype records are unavailable; no fixture fallback is permitted.", 503);
  }
}
