import { readFileSync } from "node:fs";

export const DELIVERY_INITIATIVE_LINEAGE_WORKFLOW = JSON.parse(
  readFileSync(new URL("./delivery-initiative-lineage.json", import.meta.url), "utf8"),
);

const LINEAGE_CUSTOM_FIELDS = DELIVERY_INITIATIVE_LINEAGE_WORKFLOW.custom_fields;

export const DELIVERY_INITIATIVE_FAMILY_FIELD_NAME =
  LINEAGE_CUSTOM_FIELDS.initiative_family.name;
export const DELIVERY_LINEAGE_ROLE_FIELD_NAME =
  LINEAGE_CUSTOM_FIELDS.lineage_role.name;
export const DELIVERY_ARCHITECTURE_ANCHOR_REF_FIELD_NAME =
  LINEAGE_CUSTOM_FIELDS.architecture_anchor_ref.name;
export const DELIVERY_REQUIRED_UPSTREAM_REF_FIELD_NAME =
  LINEAGE_CUSTOM_FIELDS.required_upstream_ref.name;

export const DELIVERY_INITIATIVE_FAMILIES =
  DELIVERY_INITIATIVE_LINEAGE_WORKFLOW.families.map((entry) => entry.key);
export const DELIVERY_INITIATIVE_FAMILY_SET = new Set(DELIVERY_INITIATIVE_FAMILIES);

export const DELIVERY_LINEAGE_ROLES = DELIVERY_INITIATIVE_LINEAGE_WORKFLOW.roles.map(
  (entry) => entry.key,
);
export const DELIVERY_LINEAGE_ROLE_MAP = new Map(
  DELIVERY_INITIATIVE_LINEAGE_WORKFLOW.roles.map((entry) => [entry.key, entry]),
);

export const DELIVERY_UNCLASSIFIED_INITIATIVE_SHELL =
  DELIVERY_INITIATIVE_LINEAGE_WORKFLOW.allow_unclassified_initiative_shell;

const OPENPROJECT_WORK_PACKAGE_REF_PATTERN = /^openproject:\/\/work_packages\/(\d+)$/;

function normalizeOptionalValue(value) {
  const rendered = String(value || "").trim();
  return rendered || null;
}

export function parseDeliveryInitiativeLineageRef(value) {
  const normalized = normalizeOptionalValue(value);
  if (!normalized) {
    return null;
  }

  const match = normalized.match(OPENPROJECT_WORK_PACKAGE_REF_PATTERN);
  if (!match) {
    return null;
  }

  return {
    recordId: Number.parseInt(match[1], 10),
    recordRef: normalized,
  };
}

export function validateDeliveryInitiativeLineageState({
  architectureAnchorRef = null,
  initiativeFamily = null,
  lineageRole = null,
  recordId = null,
  requiredUpstreamRef = null,
  pm2Phase = null,
  status = null,
  targetPi = null,
}) {
  const normalizedStatus = normalizeOptionalValue(status)?.toLowerCase() ?? null;
  const normalizedPm2Phase = normalizeOptionalValue(pm2Phase);
  const normalizedTargetPi = normalizeOptionalValue(targetPi);
  const normalizedFamily = normalizeOptionalValue(initiativeFamily);
  const normalizedRole = normalizeOptionalValue(lineageRole);
  const normalizedAnchorRef = normalizeOptionalValue(architectureAnchorRef);
  const normalizedUpstreamRef = normalizeOptionalValue(requiredUpstreamRef);
  const fieldsPresent = [
    normalizedFamily,
    normalizedRole,
    normalizedAnchorRef,
    normalizedUpstreamRef,
  ].some(Boolean);

  const shellAllowed =
    !fieldsPresent &&
    normalizedStatus ===
      normalizeOptionalValue(DELIVERY_UNCLASSIFIED_INITIATIVE_SHELL.status)?.toLowerCase() &&
    normalizedPm2Phase === normalizeOptionalValue(DELIVERY_UNCLASSIFIED_INITIATIVE_SHELL.pm2_phase) &&
    (!DELIVERY_UNCLASSIFIED_INITIATIVE_SHELL.target_pi_must_be_blank || !normalizedTargetPi);

  if (shellAllowed) {
    return {
      architectureAnchorRef: normalizedAnchorRef,
      initiativeFamily: normalizedFamily,
      lineageRole: normalizedRole,
      requiredUpstreamRef: normalizedUpstreamRef,
      shellAllowed,
    };
  }

  if (!normalizedFamily) {
    throw new Error(
      "Initiative Family is required once a top-level Epic leaves the new Initiating shell posture.",
    );
  }
  if (!DELIVERY_INITIATIVE_FAMILY_SET.has(normalizedFamily)) {
    throw new Error(`Initiative Family ${normalizedFamily} is not allowed.`);
  }

  if (!normalizedRole) {
    throw new Error(
      "Lineage Role is required once a top-level Epic leaves the new Initiating shell posture.",
    );
  }
  const roleSpec = DELIVERY_LINEAGE_ROLE_MAP.get(normalizedRole);
  if (!roleSpec) {
    throw new Error(`Lineage Role ${normalizedRole} is not allowed.`);
  }

  if (roleSpec.requires_anchor_ref && !normalizedAnchorRef) {
    throw new Error(
      `Lineage Role ${normalizedRole} requires Architecture Anchor Ref.`,
    );
  }
  if (roleSpec.allows_anchor_ref === false && normalizedAnchorRef) {
    throw new Error(
      `Lineage Role ${normalizedRole} must not set Architecture Anchor Ref.`,
    );
  }

  if (roleSpec.requires_upstream_ref && !normalizedUpstreamRef) {
    throw new Error(
      `Lineage Role ${normalizedRole} requires Required Upstream Ref.`,
    );
  }
  if (roleSpec.allows_upstream_ref === false && normalizedUpstreamRef) {
    throw new Error(
      `Lineage Role ${normalizedRole} must not set Required Upstream Ref.`,
    );
  }

  if (normalizedAnchorRef && !parseDeliveryInitiativeLineageRef(normalizedAnchorRef)) {
    throw new Error(
      "Architecture Anchor Ref must look like openproject://work_packages/<id>.",
    );
  }
  if (normalizedUpstreamRef && !parseDeliveryInitiativeLineageRef(normalizedUpstreamRef)) {
    throw new Error(
      "Required Upstream Ref must look like openproject://work_packages/<id>.",
    );
  }

  if (
    Number.isInteger(recordId) &&
    normalizedAnchorRef === `openproject://work_packages/${recordId}`
  ) {
    throw new Error("Architecture Anchor Ref must not point to the initiative itself.");
  }
  if (
    Number.isInteger(recordId) &&
    normalizedUpstreamRef === `openproject://work_packages/${recordId}`
  ) {
    throw new Error("Required Upstream Ref must not point to the initiative itself.");
  }

  return {
    architectureAnchorRef: normalizedAnchorRef,
    initiativeFamily: normalizedFamily,
    lineageRole: normalizedRole,
    requiredUpstreamRef: normalizedUpstreamRef,
    shellAllowed: false,
  };
}
