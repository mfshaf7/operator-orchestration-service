import { artifactContentDigest } from "../delivery-art/contracts.js";
import { canonicalDigest } from "../delivery-art/canonical-json.js";
import { assertClosureArtifact, closureError } from "./contracts.js";

export const DURABLE_OWNER_FIELDS = new Set([
  "durable_owner_acceptance_ref", "source_transfer_receipt_ref", "already_owned_source_proof_ref",
]);
const SHA = /^[0-9a-f]{40}$/;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PACKET = /^wgcf:\/\/artifacts\/delivery-art\/sha256\/([0-9a-f]{64})$/;
const requireProof = (condition, message) => {
  if (!condition) throw closureError("durable_owner_unproven", message, 409);
};

// Read existing authority, never mint an owner-authored acceptance receipt.
// Application files are compared as bounded Git objects; nothing is executed.
export function createPrototypeClosureDurableOwnerReader({
  artifactService, repositoryReader, publicSourceReader, studioSourceClient, deliveryApplicationService,
  callerOperatorBindings = {},
}) {
  for (const [value, method] of [[artifactService, "resolveArtifact"],
    [publicSourceReader, "inspectPrototypeImport"], [studioSourceClient, "readImportSource"],
    [deliveryApplicationService, "readAcceptedReceipt"]]) {
    if (typeof value?.[method] !== "function") throw closureError("owner_readback_unavailable", "Durable owner readback requires its normal authority dependencies.", 503);
  }
  if (typeof repositoryReader !== "function") throw closureError("owner_readback_unavailable", "Durable owner readback requires current canonical Inventory.", 503);

  return {
    async read(input) {
      const { field, prototype_id: prototypeId, owner_ref: owner, source_revision: sourceRevision,
        source_packet_ref: packetRef, accepted_delivery_target_receipt_ref: receiptRef,
        subject_ref: subject, operator_id: operatorId } = input;
      const ref = input.ref ?? (field === "source_transfer_receipt_ref" ? input.durable_owner_acceptance_ref : null);
      const match = typeof ref === "string" ? PACKET.exec(ref) : null;
      // Closure's immutable operator_id is the authenticated broker caller.
      // Reuse native Delivery's accepted caller -> accountable operator map;
      // do not rewrite historical commands or accept a mapping in the lookup.
      const accountableOperator = callerOperatorBindings[operatorId] ?? operatorId;
      requireProof(DURABLE_OWNER_FIELDS.has(field) && ID.test(owner ?? "") && ID.test(prototypeId ?? "") &&
        SHA.test(sourceRevision ?? "") && match && typeof operatorId === "string" && operatorId.length > 0 &&
        operatorId.length <= 128 && typeof packetRef === "string" && typeof receiptRef === "string",
      "Bind durable owner lookup to its exact native packet, operator and accepted Prototype source.");
      const before = await repositoryReader({ ownerRepo: owner, legacyRepository: null });
      const provider = { provider: "github", full_name: before.repository.full_name,
        provider_repository_id: String(before.repository.id) };
      requireProof(before.owner_repo === owner && subject === `repo://${provider.full_name}`,
        "Current active Inventory does not bind the requested owner repository.");
      const digest = `sha256:${match[1]}`;
      const { artifact: review } = await artifactService.resolveArtifact({ reference: { uri: ref, digest } });
      requireProof(review?.artifact_type === "art_review_packet" && review.status === "finalized" &&
        review.custody?.state === "durable" && review.custody.backend === "wgcf-artifact-registry" &&
        review.custody.uri === ref && review.integrity?.content_digest === digest &&
        artifactContentDigest(review) === digest && review.operator?.id === accountableOperator &&
        review.operator.decision_source === "operator" && review.landing_unit?.evidence_kind === "merged_pr",
      "Only this operator's durable finalized native merged-PR Review Packet proves owner acceptance.");
      const repos = review.landing_unit.repos.filter(row => row.repo_name === owner);
      const landed = repos[0];
      const metadataPath = `records/prototype-source-imports/${prototypeId}.json`;
      const delivery = /^delivery-([1-9][0-9]*)$/.exec(review.delivery_id ?? "");
      const prPrefix = `https://github.com/${provider.full_name}/pull/`;
      requireProof(repos.length === 1 && SHA.test(landed.merge_commit ?? "") &&
        SHA.test(landed.base_commit ?? "") && SHA.test(landed.head_commit ?? "") &&
        typeof landed.pr_url === "string" && landed.pr_url.startsWith(prPrefix) &&
        /^[1-9][0-9]*$/.test(landed.pr_url.slice(prPrefix.length)) &&
        landed.changed_files.includes(metadataPath) && delivery,
      "The finalized packet must cover this owner's reviewed source-import metadata and canonical merge.");
      const imported = await publicSourceReader.inspectPrototypeImport({ providerRepository: provider,
        mergeCommit: landed.merge_commit, prototypeId,
        validateManifest: manifest => assertClosureArtifact(manifest, "source-import-manifest") });
      const manifest = assertClosureArtifact(imported.manifest, "source-import-manifest");
      const targetRef = `openproject://work_packages/${delivery[1]}`;
      requireProof(manifest.prototype_id === prototypeId && manifest.owner_repo === owner &&
        canonicalDigest(manifest.provider_repository) === canonicalDigest(provider) &&
        manifest.delivery_target_ref === targetRef && manifest.delivery_packet_ref === packetRef &&
        manifest.accepted_delivery_target_receipt_ref === receiptRef &&
        (input.target_delivery_ref == null || input.target_delivery_ref === targetRef) &&
        (field !== "source_transfer_receipt_ref" || manifest.transfer_strategy === "transfer") &&
        (field !== "already_owned_source_proof_ref" || manifest.transfer_strategy === "already-owned"),
      "The reviewed source import belongs to a different Prototype, Delivery, owner or transfer strategy.");
      const accepted = await deliveryApplicationService.readAcceptedReceipt({
        prototypeId, packetRef, receiptRef, targetRef });
      requireProof(accepted?.receipt?.receipt_ref === receiptRef && accepted.receipt.custody?.state === "durable" &&
        accepted.source?.prototype_id === prototypeId && accepted.source.packet_ref === packetRef &&
        /^sha256:[0-9a-f]{64}$/.test(accepted.source.packet_digest ?? "") &&
        accepted.target?.record_ref === targetRef && accepted.target.record_project === "workspace-delivery-art" &&
        accepted.readiness?.outcome === "allow" && accepted.operator_decision?.decision === "apply",
      "The native Delivery application no longer proves the exact accepted source and target.");
      const studio = await studioSourceClient.readImportSource({ prototypeId, sourceRevision, packetRef,
        packetDigest: accepted.source.packet_digest, prototypeSourceRevision: manifest.prototype_source_revision });
      requireProof(studio.prototype_id === prototypeId && studio.source_revision === sourceRevision &&
        studio.prototype_source_revision === manifest.prototype_source_revision && studio.source_packet_ref === packetRef &&
        studio.packet_digest === accepted.source.packet_digest && studio.files.length === manifest.file_mappings.length,
      "Read all and only the actual accepted Studio source files.");
      const files = new Map(studio.files.map(file => [file.source_path, file]));
      const sources = new Set(), targets = new Set();
      const mapping = [];
      for (const row of manifest.file_mappings) {
        const original = files.get(row.source_path);
        requireProof(original && !sources.has(row.source_path) && !targets.has(row.owner_path) &&
          row.owner_path !== metadataPath && row.sha256 === original.sha256,
        "Source import must uniquely cover every accepted file and its exact byte digest.");
        sources.add(row.source_path); targets.add(row.owner_path);
        const target = imported.regularFile(row.owner_path);
        requireProof(target.git_blob === original.git_blob && target.git_mode === original.git_mode && target.size === original.size,
          "The canonical owner merge does not contain the exact approved Studio file bytes and modes.");
        mapping.push({ ...row, git_blob: target.git_blob, git_mode: target.git_mode, size: target.size });
      }
      await imported.recheckCurrent();
      const after = await repositoryReader({ ownerRepo: owner, legacyRepository: null });
      requireProof(canonicalDigest(before) === canonicalDigest(after), "Canonical source-owner admission changed during readback.");
      return {
        ref, owner_ref: owner,
        digest: canonicalDigest({ field, review_packet_digest: digest, owner, provider,
          merge_commit: landed.merge_commit, metadata_digest: imported.metadata_digest,
          prototype_id: prototypeId, source_revision: sourceRevision,
          prototype_source_revision: manifest.prototype_source_revision,
          source_packet_ref: packetRef, accepted_delivery_target_receipt_ref: receiptRef,
          delivery_target_ref: targetRef, requested_custody: manifest.requested_custody,
          transfer_strategy: manifest.transfer_strategy, mapping }),
        state: "accepted", subject_ref: subject, source_revision: sourceRevision,
        source_packet_ref: packetRef, prototype_id: prototypeId,
        observed_source_custody: manifest.requested_custody,
      };
    },
  };
}
