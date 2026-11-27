import { canonicalDigest } from "./canonical-json.js";

// Each pairing is reviewed against the merged source, its approved cases,
// and the retained Platform rehearsal. The browser submits the digest only.
const reviewedPair = {
  owner_repo: "operator-orchestration-service",
  source: {
    pull_request_url: "https://github.com/mfshaf7/operator-orchestration-service/pull/433",
    head_commit: "0a713fe77eb034dc570886db31b4418e1aa672f5",
    merge_commit: "de3df94439f1741954087ec5f5718b098d10cf12",
    tree: "b4fe964b19b960d1fe5fb86a394412871f910fe8",
  },
  verifier: {
    pull_request_url: "https://github.com/mfshaf7/operator-orchestration-service/pull/435",
    revision: "7391da772326acc8a3706d95c59be9af04d1aebd",
    profile_sha256: "b7ff8bb858b050b1a2984b929cead588e1881b41fcaa869b766d74c507fac3f4",
    script_sha256: "b6a489f2875b68454fc67bb12d902aab2a22ca8c90aebbbb2a5488dff47fb17c",
    canonical_json_sha256: "466464edcccc6e42fea42b595618df97cc4dbba37b957ee08b1d3070785f4249",
  },
  cases: [
    { id: "cases-b17cb044-3324-4788-8202-9e2dfc18947a", key: "recovery", title: "Recover the original run after a Broker restart" },
    { id: "cases-bc81236b-2c49-4aff-9a1f-d211ee142c79", key: "rejected_inputs", title: "Reject invalid source and replays while preserving results" },
  ],
};

export function reviewedOperatingVerification({ ownerRepo, pullRequest, packetDigest, operatingCases }) {
  if (ownerRepo !== reviewedPair.owner_repo || pullRequest?.state !== "merged" ||
      pullRequest.url !== reviewedPair.source.pull_request_url ||
      pullRequest.head_commit !== reviewedPair.source.head_commit ||
      pullRequest.merge_commit !== reviewedPair.source.merge_commit ||
      !/^sha256:[a-f0-9]{64}$/.test(packetDigest ?? "") ||
      !Array.isArray(operatingCases) || operatingCases.length !== reviewedPair.cases.length ||
      !reviewedPair.cases.every(({ id }) => operatingCases.some(entry => entry?.id === id && entry.fidelity === "sandbox-runtime"))) return null;

  const { source, verifier, cases } = reviewedPair;
  const binding = {
    source: { pull_request_url: source.pull_request_url, head_commit: source.head_commit, merge_commit: source.merge_commit },
    verifier: { pull_request_url: verifier.pull_request_url, revision: verifier.revision },
    review_packet_digest: packetDigest,
    cases: cases.map(({ id, title }) => ({ id, title })),
  };
  return { ...binding, digest: canonicalDigest({ binding, reviewedPair }) };
}

export function assertReviewedOperatingVerification(binding, ownerRepo, source, operatingCases) {
  const expected = reviewedOperatingVerification({
    ownerRepo, operatingCases, packetDigest: binding?.review_packet_digest,
    pullRequest: { state: "merged", url: binding?.source?.pull_request_url,
      head_commit: source?.head_commit, merge_commit: binding?.source?.merge_commit },
  });
  if (!expected || canonicalDigest(binding) !== canonicalDigest(expected)) {
    throw Object.assign(new Error("The original merge and reviewed verifier do not match this verification request."),
      { code: "delivery_art_operating_verifier_binding_invalid", statusCode: 409 });
  }
  return structuredClone(reviewedPair);
}
