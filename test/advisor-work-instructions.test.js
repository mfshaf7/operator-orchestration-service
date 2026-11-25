import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { parse } from "yaml";
import { advisorWorkFacts, advisorWorkInstruction, advisorWorkRoles, advisorWorkSources, advisorWorkInstructionVersion, consoleWorkflowGuide } from "../src/advisor-work-instructions.js";
import { orchestrationAdvisorCapabilities } from "../src/orchestration/catalog.js";

test("every current draft/editor role has a source-owned work guide; unknown roles cannot inherit accidental generic instructions", () => {
  const expected = ["proposal-triage", "proposal-disposition", "prototype-candidate", "prototype-baseline", "work-design-context", "work-design-tree",
    "refinement-metadata", "execution-tree", "work-design-blocker", "refinement-blocker", "definition-design", "source-editor", "execution-architecture"];
  assert.deepEqual([...advisorWorkRoles].sort(), expected.sort());
  for (const role of expected) {
    const guide = advisorWorkInstruction(role);
    assert.ok(guide.includes(`Work guide ${advisorWorkInstructionVersion}; role=${role}.`));
    assert.match(guide, /Use short paragraphs and separate distinct points with blank lines/);
    assert.match(guide, /destination field's required schema, scaffold, template/);
    for (const source of advisorWorkSources(role)) assert.ok(existsSync(new URL(`../${source}`, import.meta.url)), `${role}: ${source}`);
  }
  assert.throws(() => advisorWorkInstruction("unimplemented-role"), { code: "advisor_work_role_unknown" });
  assert.match(advisorWorkInstruction(), /Console overview assistance/);
  assert.ok(advisorWorkInstruction().includes(consoleWorkflowGuide));
  assert.match(consoleWorkflowGuide, /Work Design explains architecture/);
  assert.match(consoleWorkflowGuide, /model registration does not load project knowledge/);
  assert.match(advisorWorkInstruction("work-design-context"), /`# Descriptive title` once and `## Section heading`/);
  assert.doesNotMatch(advisorWorkInstruction("work-design-tree"), /`# Descriptive title` once/);
});

test("promotion evidence requirements and completion rule come from the actual canonical maturity contract", () => {
  const contract = parse(readFileSync(new URL("../contracts/prototype-maturity/prototype-maturity.yaml", import.meta.url), "utf8"));
  for (const [role, transition] of [["prototype-candidate", "candidate-promotion"], ["prototype-baseline", "baseline-promotion"]]) {
    const facts = advisorWorkFacts(role);
    assert.deepEqual(facts.transition, contract.prototype_lifecycle.transitions[transition]);
    assert.deepEqual(facts.requirements, contract.transition_profiles[transition]);
    assert.equal(facts.readiness_rule, contract.readiness.rule);
    assert.equal(facts.completion_rule, contract.artifact_chain.completion_rule);
    facts.requirements.required_evidence.length = 0;
    assert.ok(advisorWorkFacts(role).requirements.required_evidence.length, "A caller cannot mutate later guides.");
  }
});

test("orchestration guidance uses the registered source catalog, with exact adapter evidence and no runtime admission claim", () => {
  const facts = advisorWorkFacts("definition-design");
  const source = JSON.parse(readFileSync(new URL("../contracts/orchestration/definitions/validation-readiness-run.v1.json", import.meta.url), "utf8"));
  assert.deepEqual(facts.implemented_definition_examples, orchestrationAdvisorCapabilities());
  const actual = facts.implemented_definition_examples.find(item => item.definition_id === source.definition_id);
  assert.equal(actual.definition_version, source.definition_version);
  assert.equal(actual.execution_graph[0].activity_name, source.execution_graph[0].activity_name);
  assert.equal(actual.execution_graph[0].adapter, source.execution_graph[0].adapter);
  assert.match(actual.runtime_admission, /Not established/);
  assert.equal("start_allowed" in actual, false);
});
