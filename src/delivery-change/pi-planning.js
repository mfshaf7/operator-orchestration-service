import { HttpError } from "../errors.js";
import { resolveDeliveryTaxonomy } from "../delivery-taxonomy.js";
import { piPlanningAssignmentTypes, preparedForPIPlanning } from "../delivery-execution-navigation.js";

const featureForecastTypes = new Set(["Feature", "User story", "Defect", "Task"]);
const movableStatuses = new Set(["new", "ready"]);
const endedStatuses = new Set(["done", "parked", "retired"]);
const itemNumber = id => Number(String(id).replace(/^work-item-/, ""));
const status = item => item?.status?.toLowerCase();
const conflict = message => new HttpError(409, "pi_plan_conflict", message);
const planningDate = /^\d{4}-\d{2}-\d{2}$/;

function flatten(node, parent = null) {
  return [{ node, parent }, ...(node.children ?? []).flatMap(child => flatten(child, node))];
}

function childIdentity(item) {
  return `${item.type}\0${item.subject.trim().toLowerCase()}`;
}

function objectiveSubject(title) {
  return resolveDeliveryTaxonomy({ typeName: "PI Objective", subject: title }).subject;
}

function datedCalendar(catalog, pi) {
  const bounds = catalog.values.find(value => value.catalog_item_id === "catalog-pi-planning-date" &&
    value.parent_catalog_value_key === pi && ["active", "admitted", "read_only"].includes(value.lifecycle_state));
  const [start, end] = bounds?.value_key.split(/\.\.|\//) ?? [];
  if (!planningDate.test(start) || !planningDate.test(end) || start > end) return new Map();
  return new Map(catalog.values.filter(value => value.catalog_item_id === "catalog-iteration" &&
    value.parent_catalog_value_key === pi && value.lifecycle_state === "active" &&
    value.value_key.startsWith(`${pi} / `) && value.iteration_window &&
    value.iteration_window.start_date >= start && value.iteration_window.end_date <= end &&
    value.iteration_window.start_date <= value.iteration_window.end_date)
    .map(value => [value.value_key, value.iteration_window]));
}

export function hasSavedDeliveryPlacement(catalog, pi, iteration) {
  if (catalog.projection_status !== "ready" || !catalog.values.some(value =>
    value.catalog_item_id === "catalog-target-pi" && value.value_key === pi &&
    (["active", "admitted"].includes(value.lifecycle_state) ||
      (pi === "Program-wide" && value.lifecycle_state === "read_only")))) return false;
  if (iteration.startsWith("Program-wide / ")) {
    return catalog.values.some(value => value.catalog_item_id === "catalog-iteration" &&
      value.value_key === iteration && value.lifecycle_state === "active");
  }
  return datedCalendar(catalog, pi).has(iteration);
}

function featureAdditionSubjects(addition) {
  return {
    feature: resolveDeliveryTaxonomy({ typeName: "Feature", subject: addition.title.trim() }).subject,
    child: resolveDeliveryTaxonomy({
      typeName: addition.first_work_item.type, subject: addition.first_work_item.title.trim(),
    }).subject,
  };
}

function prepareFeatureAddition(tree, pi, addition, calendar) {
  const openObjective = tree.children?.some(child => child.type === "PI Objective" &&
    child.target_pi === pi && !endedStatuses.has(status(child)));
  if (!openObjective) throw conflict("This Epic needs an open objective in the selected PI before adding a Feature.");
  const subjects = featureAdditionSubjects(addition);
  if (!subjects.feature || !subjects.child || !addition.description.trim() || !addition.first_work_item.description.trim()) {
    throw conflict("Provide a title and description for the Feature and its first work item.");
  }
  if (tree.children.some(child => child.type === "Feature" && child.subject.trim().toLowerCase() === subjects.feature.toLowerCase())) {
    throw conflict("An existing Feature already has this title. Choose a distinct title or review the existing Feature.");
  }
  const findWindow = placement => {
    const window = calendar.get(placement.iteration);
    if (!window || window.start_date !== placement.start_date || window.end_date !== placement.end_date) {
      throw conflict(`The dates for ${placement.iteration} changed. Review the current calendar.`);
    }
    return window;
  };
  const firstWork = findWindow(addition.first_work_item.placement);
  const target = findWindow(addition.delivery_target);
  if (firstWork.sequence > target.sequence) {
    throw conflict("The first work item must finish by the Feature’s delivery target.");
  }
  if (firstWork.sequence < target.sequence && !addition.delivery_target_reason?.trim()) {
    throw conflict("Explain the later delivery target for this Feature.");
  }

  return { schema_version: 1, items: [{
    type: "Feature", subject: subjects.feature, description: addition.description.trim(),
    target_pi: pi, iteration: addition.delivery_target.iteration,
    children: [{
      type: addition.first_work_item.type, subject: subjects.child, description: addition.first_work_item.description.trim(),
      target_pi: pi, iteration: addition.first_work_item.placement.iteration,
    }],
  }] };
}

export async function preparePIPlan({ payload, source, catalog, loadPlanningFacts }) {
  const { pi, objective, feature_addition: addition } = payload;
  const piValue = catalog.values.find(value => value.catalog_item_id === "catalog-target-pi" &&
    value.value_key === pi && value.lifecycle_state === "active");
  const calendar = datedCalendar(catalog, pi);
  if (catalog.projection_status !== "ready" || !piValue || !calendar.size) {
    throw conflict("Set up the planning calendar for this PI before assigning work.");
  }
  const tree = source.execution_tree;
  if (endedStatuses.has(status(tree))) throw conflict("This Epic is no longer open for planning.");
  if (addition) return prepareFeatureAddition(tree, pi, addition, calendar);
  const scope = flatten(tree);
  const byId = new Map(scope.map(entry => [entry.node.id, entry]));
  const assignments = new Map();
  for (const accepted of payload.assignments) {
    const number = itemNumber(accepted.work_item_id);
    const item = byId.get(number)?.node;
    const window = calendar.get(accepted.iteration);
    if (!item || !piPlanningAssignmentTypes.has(item.type) || !movableStatuses.has(status(item)) ||
        item.target_pi && item.target_pi !== pi || assignments.has(number)) {
      throw conflict(`Work item #${number} cannot be scheduled in this PI. Review the current Epic.`);
    }
    if (!preparedForPIPlanning(item)) {
      throw conflict(`Finish preparing work item #${number} in Refinement before scheduling it.`);
    }
    if (!window || window.start_date !== accepted.start_date || window.end_date !== accepted.end_date) {
      throw conflict(`The dates for ${accepted.iteration} changed. Review the current calendar.`);
    }
    assignments.set(number, accepted);
  }
  const effective = item => {
    const changed = assignments.get(item?.id);
    return changed ? calendar.get(changed.iteration) : item?.target_pi === pi ? calendar.get(item.iteration) : undefined;
  };
  for (const { node, parent } of scope) {
    if (assignments.has(node.id) && parent?.type === "Feature" && !effective(parent)) {
      throw conflict(`Set a delivery target for “${parent.subject}” before scheduling its child work.`);
    }
    if (node.type !== "Feature") continue;
    const target = effective(node);
    const descendants = (node.children ?? []).flatMap(child => flatten(child)).map(({ node: child }) => child)
      .filter(child => featureForecastTypes.has(child.type) && !["parked", "retired"].includes(status(child)));
    if (!target || !(assignments.has(node.id) || descendants.some(child => assignments.has(child.id)))) continue;
    const childWindows = descendants.map(effective).filter(Boolean);
    const latest = Math.max(0, ...childWindows.map(window => window.sequence));
    if (latest > target.sequence) throw conflict(`Child work continues past the delivery target for “${node.subject}”.`);
    if (latest && target.sequence > latest && descendants.every(child => effective(child) || status(child) === "done") &&
        assignments.has(node.id) && !assignments.get(node.id).delivery_target_reason?.trim()) {
      throw conflict(`Explain the later delivery target for “${node.subject}”.`);
    }
  }

  const relations = source.dependency_relations.filter(({ target, depends_on }) =>
    assignments.has(target.id) || assignments.has(depends_on.id));
  const externalIds = [...new Set(relations.flatMap(({ target, depends_on }) => [target.id, depends_on.id]))].filter(id => !byId.has(id));
  const external = new Map((externalIds.length ? await loadPlanningFacts(externalIds) : []).map(item => [item.id, item]));
  for (const { target, depends_on } of relations) {
    const dependent = byId.get(target.id)?.node ?? external.get(target.id);
    const prerequisite = byId.get(depends_on.id)?.node ?? external.get(depends_on.id);
    if (!dependent || !prerequisite) throw conflict("A dependency could not be verified. Refresh the plan.");
    const scheduled = effective(dependent);
    if (!scheduled || endedStatuses.has(status(dependent)) || status(prerequisite) === "done") continue;
    const earlier = effective(prerequisite);
    if (!earlier || earlier.sequence > scheduled.sequence || ["parked", "retired"].includes(status(prerequisite))) {
      throw conflict(`Schedule “${prerequisite.subject}” before “${dependent.subject}”.`);
    }
  }

  const objectiveId = objective.work_item_id ? itemNumber(objective.work_item_id) : null;
  const existing = objectiveId ? byId.get(objectiveId)?.node : null;
  const title = objectiveSubject(objective.title.trim());
  const titleMatch = (tree.children ?? []).find(child => child.type === "PI Objective" &&
    child.subject.trim().toLowerCase() === title.toLowerCase());
  if (!title || !Number.isSafeInteger(objective.planned_business_value) ||
      (objectiveId ? !existing || existing !== titleMatch || existing.target_pi !== pi || endedStatuses.has(status(existing))
        : titleMatch || !objective.description?.trim())) {
    throw conflict("Choose a current objective for this PI or provide a new objective and its expected outcome.");
  }
  const firstIteration = [...calendar].sort((left, right) => left[1].sequence - right[1].sequence)[0][0];
  const objectivePlan = {
    type: "PI Objective",
    subject: title,
    piObjectiveType: objective.type,
    plannedBusinessValue: String(objective.planned_business_value),
    ...(existing ? {} : { target_pi: pi, iteration: firstIteration, description: objective.description.trim() }),
  };

  function changedChildren(parent) {
    const children = parent.children ?? [];
    const visited = new Set();
    const duplicates = new Set();
    for (const child of children) {
      const identity = childIdentity(child);
      if (visited.has(identity)) duplicates.add(identity);
      visited.add(identity);
    }
    return children.flatMap(child => {
      const descendants = changedChildren(child);
      const placement = assignments.get(child.id);
      if (!placement && !descendants.length && child.id !== objectiveId) return [];
      if (duplicates.has(childIdentity(child))) {
        throw conflict(`Resolve duplicate names under “${parent.subject}” before applying the plan.`);
      }
      if (child.id === objectiveId) return [objectivePlan];
      return [{
        type: child.type,
        subject: child.subject,
        ...(child.execution_classification ? { executionClassification: child.execution_classification } : {}),
        ...(placement ? { target_pi: pi, iteration: placement.iteration } : {}),
        ...(descendants.length ? { children: descendants } : {}),
      }];
    });
  }
  const items = changedChildren(tree);
  if (!objectiveId) items.push(objectivePlan);
  return { schema_version: 1, items };
}

export function confirmPIPlan(payload, tree) {
  const addition = payload.feature_addition;
  if (addition) {
    const subjects = featureAdditionSubjects(addition);
    const feature = tree.children?.find(node => node.type === "Feature" && node.subject === subjects.feature);
    const child = feature?.children?.find(node => node.type === addition.first_work_item.type && node.subject === subjects.child);
    return feature?.target_pi === payload.pi && feature.iteration === addition.delivery_target.iteration &&
      child?.target_pi === payload.pi && child.iteration === addition.first_work_item.placement.iteration;
  }
  const nodes = new Map(flatten(tree).map(({ node }) => [node.id, node]));
  const objective = payload.objective.work_item_id
    ? nodes.get(itemNumber(payload.objective.work_item_id))
    : tree.children?.find(node => node.type === "PI Objective" && node.subject === objectiveSubject(payload.objective.title));
  return objective?.target_pi === payload.pi && objective.pi_objective_type === payload.objective.type &&
    String(objective.planned_business_value) === String(payload.objective.planned_business_value) &&
    payload.assignments.every(assignment => {
      const item = nodes.get(itemNumber(assignment.work_item_id));
      return item?.target_pi === payload.pi && item.iteration === assignment.iteration;
    });
}
