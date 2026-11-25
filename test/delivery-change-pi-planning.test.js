import assert from "node:assert/strict";
import test from "node:test";
import { confirmPIPlan, preparePIPlan } from "../src/delivery-change/pi-planning.js";

const pi = "PI-2027-01";
const first = `${pi} / Iteration 1`;
const second = `${pi} / Iteration 2`;
const window = (sequence, start_date, end_date) => ({ sequence, start_date, end_date });
const firstWindow = window(1, "2027-01-11", "2027-01-24");
const secondWindow = window(2, "2027-01-25", "2027-02-07");
const catalog = {
  projection_status: "ready",
  values: [
    { catalog_item_id: "catalog-target-pi", value_key: pi, lifecycle_state: "active" },
    { catalog_item_id: "catalog-pi-planning-date", value_key: "2027-01-11/2027-02-07",
      parent_catalog_value_key: pi, lifecycle_state: "read_only" },
    ...[[first, firstWindow], [second, secondWindow]].map(([value_key, iteration_window]) => ({
      catalog_item_id: "catalog-iteration", value_key, iteration_window,
      parent_catalog_value_key: pi, lifecycle_state: "active",
    })),
  ],
};

function data() {
  const preparation = { ready_contract_applicable: true, ready_contract_satisfied: false,
    ready_contract_missing_fields: ["Iteration"] };
  const story = { ...preparation, id: 3, type: "User story", subject: "Read current schedule", status: "new", children: [] };
  const feature = { ...preparation, id: 2, type: "Feature", subject: "Calendar", status: "new", children: [story] };
  const source = {
    execution_tree: { id: 1, type: "Epic", subject: "Plan work", status: "new", children: [feature] },
    dependency_relations: [],
  };
  const assign = (id, iteration, { start_date, end_date }) => ({ work_item_id: String(id), iteration, start_date, end_date });
  const payload = {
    pi,
    assignments: [assign(2, second, secondWindow), assign(3, second, secondWindow)],
    objective: { work_item_id: null, title: "See scheduled work", type: "Committed", planned_business_value: 3,
      description: "## Outcome\n\nThe team can see when work will start." },
  };
  return { source, payload, story, feature, assign };
}

test("PI planning keeps existing hierarchy and confirms the exact work and objective", async () => {
  const { source, payload, story, feature } = data();
  const plan = await preparePIPlan({ source, payload, catalog });
  assert.deepEqual(plan.items.map(({ type }) => type), ["Feature", "PI Objective"]);
  assert.deepEqual(plan.items[0].children, [{ type: "User story", subject: story.subject, target_pi: pi, iteration: second }]);
  assert.equal(plan.items[0].description, undefined);
  assert.equal(plan.items[1].iteration, first);
  assert.equal(confirmPIPlan(payload, source.execution_tree), false);
  Object.assign(story, { target_pi: pi, iteration: second });
  Object.assign(feature, { target_pi: pi, iteration: second });
  source.execution_tree.children.push({ id: 4, type: "PI Objective", subject: payload.objective.title,
    target_pi: pi, pi_objective_type: "Committed", planned_business_value: 3 });
  assert.equal(confirmPIPlan(payload, source.execution_tree), true);
});

test("PI planning rejects stale iteration dates and a delivery target before child work", async () => {
  const { source, payload, assign } = data();
  payload.assignments[0] = { ...payload.assignments[0], end_date: "2027-02-08" };
  await assert.rejects(preparePIPlan({ source, payload, catalog }), /dates .* changed/);
  payload.assignments[0] = assign(2, first, firstWindow);
  await assert.rejects(preparePIPlan({ source, payload, catalog }), /continues past the delivery target/);
});

test("PI planning requires native preparation and a dated PI window before it accepts work", async () => {
  const { source, payload, story, feature } = data();
  const undated = { ...catalog, values: catalog.values.filter(value => value.catalog_item_id !== "catalog-pi-planning-date") };
  await assert.rejects(preparePIPlan({ source, payload, catalog: undated }), /Set up the planning calendar/);
  story.ready_contract_missing_fields = ["Iteration", "Acceptance Criteria"];
  await assert.rejects(preparePIPlan({ source, payload, catalog }), /Finish preparing work item #3/);
  feature.dependency_blocked = true;
  await assert.rejects(preparePIPlan({ source, payload, catalog }), /Finish preparing work item #3/);
});

test("PI planning places existing risks and milestones with their original identities", async () => {
  const { source, payload, assign } = data();
  const prepared = {
    status: "new",
    children: [],
    ready_contract_applicable: true,
    ready_contract_satisfied: false,
    ready_contract_missing_fields: ["Iteration"],
  };
  const risk = { ...prepared, id: 7, type: "Risk", subject: "Risk: Resolve source custody" };
  const milestone = { ...prepared, id: 8, type: "Milestone", subject: "Review runtime evidence" };
  const objective = {
    id: 4, type: "PI Objective", subject: payload.objective.title, status: "new", target_pi: pi,
    pi_objective_type: "Committed", planned_business_value: 3,
  };
  source.execution_tree.children.push(risk, milestone, objective);
  payload.objective.work_item_id = "4";
  payload.assignments = [assign(7, first, firstWindow), assign(8, second, secondWindow)];

  const plan = await preparePIPlan({ source, payload, catalog });
  assert.deepEqual(plan.items.slice(0, 2), [
    { type: "Risk", subject: risk.subject, target_pi: pi, iteration: first },
    { type: "Milestone", subject: milestone.subject, target_pi: pi, iteration: second },
  ]);
  assert.equal(confirmPIPlan(payload, source.execution_tree), false);
  Object.assign(risk, { target_pi: pi, iteration: first });
  Object.assign(milestone, { target_pi: pi, iteration: second });
  assert.equal(confirmPIPlan(payload, source.execution_tree), true);

  risk.ready_contract_missing_fields = ["Risk Owner", "Iteration"];
  await assert.rejects(preparePIPlan({ source, payload, catalog }), /Finish preparing work item #7/);
});

test("PI planning resolves cross-Epic prerequisites from current canonical fields", async () => {
  const { source, payload } = data();
  source.dependency_relations = [{ target: { id: 3 }, depends_on: { id: 17 } }];
  const loadPlanningFacts = async ids => {
    assert.deepEqual(ids, [17]);
    return [{ id: 17, subject: "Define the schedule", status: "new", target_pi: null }];
  };
  await assert.rejects(preparePIPlan({ source, payload, catalog, loadPlanningFacts }), /Schedule “Define the schedule” before/);
  const plan = await preparePIPlan({ source, payload, catalog, loadPlanningFacts: async () =>
    [{ id: 17, subject: "Define the schedule", status: "new", target_pi: pi, iteration: first }] });
  assert.equal(plan.items[0].children[0].iteration, second);
});


test("adding a Feature uses a sparse plan and confirms exact child and calendar placement", async () => {
  const { source, feature } = data();
  const payload = {
    pi,
    feature_addition: {
      title: "Plan deployment", description: "The deployment has a reviewed schedule.",
      delivery_target: { iteration: second, ...secondWindow },
      first_work_item: {
        type: "User story", title: "Verify rollback", description: "Check the saved rollback steps.",
        placement: { iteration: first, ...firstWindow },
      },
    },
  };
  await assert.rejects(preparePIPlan({ source, payload, catalog }), /needs an open objective/);
  source.execution_tree.children.push({ type: "PI Objective", target_pi: pi, status: "new", children: [] });
  await assert.rejects(preparePIPlan({ source, payload, catalog }), /Explain the later delivery target/);
  payload.feature_addition.delivery_target_reason = "Use the next scheduled deployment window.";
  const plan = await preparePIPlan({ source, payload, catalog });
  assert.deepEqual(plan.items.map(item => [item.type, item.subject, item.iteration]), [["Feature", "Plan deployment", second]]);
  assert.equal(plan.items[0].children[0].iteration, first);
  assert.equal(confirmPIPlan(payload, source.execution_tree), false);
  source.execution_tree.children.push(plan.items[0]);
  assert.equal(confirmPIPlan(payload, source.execution_tree), true);
  assert.equal(feature.target_pi, undefined);
  await assert.rejects(preparePIPlan({ source, payload, catalog }), /already has this title/);
  source.execution_tree.children.pop();
  payload.feature_addition.delivery_target = { iteration: first, ...firstWindow };
  payload.feature_addition.first_work_item.placement = { iteration: second, ...secondWindow };
  await assert.rejects(preparePIPlan({ source, payload, catalog }), /finish by the Feature/);
});
