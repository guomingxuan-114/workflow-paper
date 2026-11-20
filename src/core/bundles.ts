import { createId } from "./id";
import type {
  Point,
  WorkflowBundle,
  WorkflowDocument,
  WorkflowEdge,
} from "./types";

export function reconcileWorkflowBundles(
  document: WorkflowDocument,
): WorkflowDocument {
  const edgeById = new Map(document.edges.map((edge) => [edge.id, edge]));
  const updatedEdges = new Map(
    document.edges.map((edge) => [
      edge.id,
      { ...edge, bundleId: undefined as string | undefined },
    ]),
  );
  const bundles: WorkflowBundle[] = [];

  for (const bundle of document.bundles) {
    const members = bundle.edgeIds
      .map((id) => edgeById.get(id))
      .filter(
        (edge): edge is WorkflowEdge =>
          Boolean(edge && edge.source === bundle.sourceId),
      );
    const unique = [
      ...new Map(members.map((edge) => [edge.id, edge])).values(),
    ];
    if (unique.length >= 2) {
      for (const edge of unique) {
        updatedEdges.set(edge.id, {
          ...updatedEdges.get(edge.id)!,
          bundleId: bundle.id,
        });
      }
      bundles.push({
        ...bundle,
        edgeIds: unique.map((edge) => edge.id),
      });
      continue;
    }
    if (unique.length === 1) {
      const edge = updatedEdges.get(unique[0].id)!;
      updatedEdges.set(edge.id, {
        ...edge,
        label:
          bundle.label.trim() && edge.label?.trim()
            ? `${bundle.label} · ${edge.label}`
            : bundle.label || edge.label,
        bundleId: undefined,
      });
    }
  }

  return {
    ...document,
    edges: document.edges.map((edge) => updatedEdges.get(edge.id) ?? edge),
    bundles,
  };
}

export function createBranchBundle(
  document: WorkflowDocument,
  sourceId: string,
  edgeIds: string[],
  label = "",
): WorkflowDocument {
  const existing = document.bundles.find((bundle) =>
    edgeIds.some((id) => bundle.edgeIds.includes(id)),
  );
  if (existing) {
    return addEdgeToBundle(document, existing.id, edgeIds[edgeIds.length - 1]);
  }
  const valid = edgeIds.filter((id) =>
    document.edges.some(
      (edge) => edge.id === id && edge.source === sourceId,
    ),
  );
  if (valid.length < 2) return document;
  const bundle: WorkflowBundle = {
    id: createId("bundle"),
    sourceId,
    edgeIds: valid,
    label,
    visible: true,
    color: "coral",
  };
  return reconcileWorkflowBundles({
    ...document,
    edges: document.edges.map((edge) =>
      valid.includes(edge.id) ? { ...edge, bundleId: bundle.id } : edge,
    ),
    bundles: [...document.bundles, bundle],
  });
}

export function addEdgeToBundle(
  document: WorkflowDocument,
  bundleId: string,
  edgeId: string,
): WorkflowDocument {
  const bundle = document.bundles.find((item) => item.id === bundleId);
  const edge = document.edges.find((item) => item.id === edgeId);
  if (!bundle || !edge || edge.source !== bundle.sourceId) return document;
  return reconcileWorkflowBundles({
    ...document,
    edges: document.edges.map((item) =>
      item.id === edgeId ? { ...item, bundleId } : item,
    ),
    bundles: document.bundles.map((item) =>
      item.id === bundleId
        ? { ...item, edgeIds: [...new Set([...item.edgeIds, edgeId])] }
        : item,
    ),
  });
}

export function attachEdgeToSourceBundle(
  document: WorkflowDocument,
  sourceId: string,
  edgeId: string,
  direction?: Point,
): WorkflowDocument {
  const edge = document.edges.find(
    (item) => item.id === edgeId && item.source === sourceId,
  );
  const sourceLayout = document.layout.nodes[sourceId];
  if (!edge || !sourceLayout) return document;

  const sourceCenter = {
    x: sourceLayout.x + sourceLayout.width / 2,
    y: sourceLayout.y + sourceLayout.height / 2,
  };
  const requested = direction ?? document.layout.nodes[edge.target];
  const requestedVector = requested
    ? {
        x: requested.x - sourceCenter.x,
        y: requested.y - sourceCenter.y,
      }
    : { x: 1, y: 0 };
  const requestedLength = Math.max(
    1,
    Math.hypot(requestedVector.x, requestedVector.y),
  );

  const candidates = document.bundles
    .filter((bundle) => bundle.sourceId === sourceId)
    .map((bundle) => {
      const memberCenters = bundle.edgeIds
        .map((id) => document.edges.find((item) => item.id === id))
        .flatMap((item) => {
          const layout = item
            ? document.layout.nodes[item.target]
            : undefined;
          return layout ? [layout] : [];
        })
        .map((layout) => ({
          x: layout.x + layout.width / 2 - sourceCenter.x,
          y: layout.y + layout.height / 2 - sourceCenter.y,
        }));
      if (memberCenters.length === 0) {
        return { bundle, angle: Number.POSITIVE_INFINITY };
      }
      const average = {
        x:
          memberCenters.reduce((sum, point) => sum + point.x, 0) /
          memberCenters.length,
        y:
          memberCenters.reduce((sum, point) => sum + point.y, 0) /
          memberCenters.length,
      };
      const length = Math.max(1, Math.hypot(average.x, average.y));
      const cosine = Math.max(
        -1,
        Math.min(
          1,
          (average.x * requestedVector.x +
            average.y * requestedVector.y) /
            (length * requestedLength),
        ),
      );
      return { bundle, angle: Math.acos(cosine) };
    })
    .filter((candidate) => candidate.angle <= (72 * Math.PI) / 180)
    .sort((left, right) => left.angle - right.angle);

  if (candidates[0]) {
    return addEdgeToBundle(document, candidates[0].bundle.id, edgeId);
  }

  const bundle: WorkflowBundle = {
    id: createId("bundle"),
    sourceId,
    edgeIds: [edgeId],
    label: "",
    visible: true,
    color: "coral",
  };
  return {
    ...document,
    edges: document.edges.map((item) =>
      item.id === edgeId ? { ...item, bundleId: bundle.id } : item,
    ),
    bundles: [...document.bundles, bundle],
  };
}

export function updateBundle(
  document: WorkflowDocument,
  bundleId: string,
  patch: Partial<Omit<WorkflowBundle, "id" | "sourceId">>,
): WorkflowDocument {
  return reconcileWorkflowBundles({
    ...document,
    bundles: document.bundles.map((bundle) =>
      bundle.id === bundleId
        ? { ...bundle, ...patch, id: bundle.id, sourceId: bundle.sourceId }
        : bundle,
    ),
  });
}
