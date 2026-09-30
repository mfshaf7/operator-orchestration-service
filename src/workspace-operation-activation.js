const COMMIT = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;

export const workspaceOperationActivation = Object.freeze({
  authorityCommit: "e3864940dd6961426de93fa5cdb2215a86a5aca1",
  readinessCommit: "0d0b686ea78397d91f64b498d78a4aa6651e1c05",
  contractWorkRef: "openproject://work_packages/1206",
  orchestrationWorkRef: "openproject://work_packages/1208",
  consoleWorkRef: "openproject://work_packages/1209",
  securityWorkRef: "openproject://work_packages/1216",
  platformWorkRef: "openproject://work_packages/1217",
  operatingProofWorkRef: "openproject://work_packages/1210",
  architecturePacketRef: "architecture-packet:delivery-1203-v1",
  architecturePacketDigest:
    "sha256:0d079fe025eebd77da75e306e1e31d8281e141a1983907ad15c128ee41644557",
  activationContractDigest:
    "5ad9f582d39730f506658e1ca37fd75f57c11a0703c8978176c2e7e0936dac85",
  activationSchemaDigest:
    "32538b651ce50ad549f6268b5e62302b324e17b3a1dcc98fffb6aca49b4d3ceb",
});

function fail(domain) {
  throw new Error(`${domain} operation activation manifest is invalid.`);
}

export function assertWorkspaceOperationActivation(manifest, {
  domain,
  readinessContractId,
  readinessManifestPath,
}) {
  const expected = workspaceOperationActivation;
  const source = manifest?.source_activation;
  const runtime = manifest?.runtime_activation;
  const authority = source?.authority;
  const readiness = source?.readiness_authority;
  const contract = source?.activation_contract;
  const packet = source?.architecture_packet;

  if (
    source?.state !== "ready-for-console-adapter" ||
    source?.orchestration_work_ref !== expected.orchestrationWorkRef ||
    authority?.repo !== "workspace-governance" ||
    authority?.commit !== expected.authorityCommit ||
    !COMMIT.test(authority?.commit) ||
    readiness?.repo !== "workspace-governance-control-fabric" ||
    readiness?.commit !== expected.readinessCommit ||
    !COMMIT.test(readiness?.commit) ||
    readiness?.manifest_path !== readinessManifestPath ||
    readiness?.contract_id !== readinessContractId ||
    contract?.repo !== "workspace-governance" ||
    contract?.commit !== expected.authorityCommit ||
    contract?.path !== "contracts/workspace-intake-inventory-operation.yaml" ||
    contract?.schema_path !==
      "contracts/schemas/workspace-intake-inventory-operation.schema.json" ||
    contract?.contract_work_ref !== expected.contractWorkRef ||
    contract?.architecture_packet_ref !== expected.architecturePacketRef ||
    contract?.content_sha256 !== expected.activationContractDigest ||
    contract?.schema_sha256 !== expected.activationSchemaDigest ||
    packet?.ref !== expected.architecturePacketRef ||
    packet?.digest !== expected.architecturePacketDigest ||
    !SHA256.test(packet?.digest) ||
    packet?.uri !==
      `wgcf://artifacts/delivery-art/${packet.digest.replace(":", "/")}` ||
    runtime?.eligible !== true ||
    runtime?.profile !== "dev-integration" ||
    runtime?.state !== "platform-composition-required" ||
    runtime?.next_work_ref !== expected.consoleWorkRef ||
    runtime?.security_work_ref !== expected.securityWorkRef ||
    runtime?.platform_work_ref !== expected.platformWorkRef ||
    runtime?.operating_proof_work_ref !== expected.operatingProofWorkRef
  ) {
    fail(domain);
  }

  for (const entry of Object.values(manifest.files ?? {})) {
    if (entry.repo === authority.repo && entry.commit !== authority.commit) fail(domain);
    if (entry.repo === readiness.repo && entry.commit !== readiness.commit) fail(domain);
  }

  return manifest;
}

export function isWorkspaceOperationRuntimeEnabled(manifest, profile) {
  return manifest.runtime_activation?.eligible === true &&
    manifest.runtime_activation.profile === "dev-integration" &&
    profile === "dev-integration";
}
