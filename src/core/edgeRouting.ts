import { getHiddenNodeIds } from "./document";
import {
  boundaryPointToward,
  distributeBoundaryPoints,
  nodeContainsPoint,
} from "./nodeShapes";
import type {
  Point,
  WorkflowBundle,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowLayout,
  WorkflowNode,
} from "./types";

export type RouteSide = "left" | "right" | "top" | "bottom";

interface CurveSegment {
  start: Point;
  control1: Point;
  control2: Point;
  end: Point;
}

export interface EdgeRoute {
  edgeId: string;
  sourceId: string;
  targetId: string;
  bundleId?: string;
  sourcePoint: Point;
  forkPoint: Point;
  targetPoint: Point;
  trunkPath: string;
  armPath: string;
  control1: Point;
  control2: Point;
  path: string;
  segments: CurveSegment[];
  hitPoints: Point[];
  labelPoint: Point;
  side: RouteSide;
  important: boolean;
}

export interface BranchPoint {
  id: string;
  bundleId: string;
  sourceId: string;
  point: Point;
  labelPoint: Point;
  label: string;
  visible: boolean;
  edgeIds: string[];
  side: RouteSide;
  trunkPath: string;
}

export interface WorkflowRouting {
  routes: Record<string, EdgeRoute>;
  branches: Record<string, BranchPoint>;
  cacheHits: number;
}

interface CachedGroup {
  signature: string;
  routes: EdgeRoute[];
  branch?: BranchPoint;
}

export type RoutingCache = Map<string, CachedGroup>;

type NodeRect = WorkflowLayout["nodes"][string];

export function documentWithNodePositions(
  document: WorkflowDocument,
  positions: Record<string, Point>,
): WorkflowDocument {
  const changed = Object.entries(positions).filter(
    ([id, point]) =>
      document.layout.nodes[id] &&
      (document.layout.nodes[id].x !== point.x ||
        document.layout.nodes[id].y !== point.y),
  );
  if (changed.length === 0) return document;
  const nodes = { ...document.layout.nodes };
  for (const [id, point] of changed) {
    nodes[id] = { ...nodes[id], x: point.x, y: point.y };
  }
  return {
    ...document,
    layout: { ...document.layout, nodes },
  };
}

function center(rect: NodeRect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function sideToward(rect: NodeRect, target: Point): RouteSide {
  const origin = center(rect);
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function offsetPoint(point: Point, side: RouteSide, length: number): Point {
  if (side === "left") return { x: point.x - length, y: point.y };
  if (side === "right") return { x: point.x + length, y: point.y };
  if (side === "top") return { x: point.x, y: point.y - length };
  return { x: point.x, y: point.y + length };
}

function trunkLength(source: NodeRect, targets: NodeRect[], side: RouteSide) {
  const gaps = targets.map((rect) => {
    if (side === "right") return rect.x - (source.x + source.width);
    if (side === "left") return source.x - (rect.x + rect.width);
    if (side === "bottom") return rect.y - (source.y + source.height);
    return source.y - (rect.y + rect.height);
  });
  const positive = gaps.filter((value) => value > 0);
  return Math.max(
    56,
    Math.min(
      110,
      (positive.length > 0
        ? Math.min(...positive)
        : Math.min(source.width, source.height) * 0.4) * 0.42,
    ),
  );
}

function sideNormal(side: RouteSide): Point {
  if (side === "left") return { x: -1, y: 0 };
  if (side === "right") return { x: 1, y: 0 };
  if (side === "top") return { x: 0, y: -1 };
  return { x: 0, y: 1 };
}

function oppositeSide(side: RouteSide): RouteSide {
  if (side === "left") return "right";
  if (side === "right") return "left";
  if (side === "top") return "bottom";
  return "top";
}

function buildCurve(
  from: Point,
  to: Point,
  fromSide: RouteSide,
  toSide: RouteSide,
): CurveSegment & { command: string } {
  const distance = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
  const bend = Math.max(22, Math.min(35, distance * 0.22));
  const drift = Math.min(0.06, Math.max(0.04, 28 / distance));
  const fromNormal = sideNormal(fromSide);
  const toNormal = sideNormal(toSide);
  const control1 = {
    x: from.x + fromNormal.x * bend + (to.x - from.x) * drift,
    y: from.y + fromNormal.y * bend + (to.y - from.y) * drift,
  };
  const control2 = {
    x: to.x + toNormal.x * bend + (from.x - to.x) * drift * 0.8,
    y: to.y + toNormal.y * bend + (from.y - to.y) * drift * 0.8,
  };
  return {
    start: from,
    control1,
    control2,
    end: to,
    command: `C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${to.x} ${to.y}`,
  };
}

function buildForwardCurve(
  from: Point,
  to: Point,
): CurveSegment & { command: string } {
  const control1 = {
    x: from.x + (to.x - from.x) * 0.38,
    y: from.y + (to.y - from.y) * 0.38,
  };
  const control2 = {
    x: from.x + (to.x - from.x) * 0.72,
    y: from.y + (to.y - from.y) * 0.72,
  };
  return {
    start: from,
    control1,
    control2,
    end: to,
    command: `C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${to.x} ${to.y}`,
  };
}

function curvePath(segment: CurveSegment & { command?: string }): string {
  return `M ${segment.start.x} ${segment.start.y} ${
    segment.command ??
    `C ${segment.control1.x} ${segment.control1.y}, ${segment.control2.x} ${segment.control2.y}, ${segment.end.x} ${segment.end.y}`
  }`;
}

function curveSamples(
  segment: CurveSegment,
  steps: number,
): Point[] {
  const points: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    points.push(
      cubicPoint(
        segment.start,
        segment.control1,
        segment.control2,
        segment.end,
        index / steps,
      ),
    );
  }
  return points;
}

function visibleEdges(
  document: WorkflowDocument,
  visibleNodeIds?: Set<string>,
): WorkflowEdge[] {
  const hidden = getHiddenNodeIds(document);
  return document.edges.filter((edge) => {
    if (hidden.has(edge.source) || hidden.has(edge.target)) return false;
    if (
      visibleNodeIds &&
      (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target))
    ) {
      return false;
    }
    return Boolean(
      document.layout.nodes[edge.source] && document.layout.nodes[edge.target],
    );
  });
}

function groupSignature(
  source: WorkflowNode,
  sourceLayout: NodeRect,
  edges: WorkflowEdge[],
  bundle: WorkflowBundle | undefined,
  document: WorkflowDocument,
) {
  return JSON.stringify({
    source: {
      id: source.id,
      type: source.type,
      milestone: source.milestone,
      important: source.important,
      layout: sourceLayout,
    },
    edges: edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      targetNode: document.nodes.find((node) => node.id === edge.target),
      targetLayout: document.layout.nodes[edge.target],
      label: edge.label,
      important: edge.important,
    })),
    bundle,
  });
}

function buildEdgeGroup(
  source: WorkflowNode,
  sourceLayout: NodeRect,
  edges: WorkflowEdge[],
  document: WorkflowDocument,
  bundle?: WorkflowBundle,
  distributedSourcePoint?: Point,
  distributedTargetPoints: Record<string, Point> = {},
): { routes: EdgeRoute[]; branch?: BranchPoint } {
  const targets = edges
    .map((edge) => ({
      edge,
      node: document.nodes.find((node) => node.id === edge.target),
      layout: document.layout.nodes[edge.target],
    }))
    .filter(
      (item): item is {
        edge: WorkflowEdge;
        node: WorkflowNode;
        layout: NodeRect;
      } => Boolean(item.node && item.layout),
    );
  if (targets.length === 0) return { routes: [] };

  const average = {
    x:
      targets.reduce((sum, item) => sum + center(item.layout).x, 0) /
      targets.length,
    y:
      targets.reduce((sum, item) => sum + center(item.layout).y, 0) /
      targets.length,
  };
  const side = sideToward(sourceLayout, {
    x: distributedSourcePoint?.x ?? average.x,
    y: distributedSourcePoint?.y ?? average.y,
  });
  const shared = Boolean(bundle && edges.length > 1);
  const sourcePoint = shared
    ? distributedSourcePoint ??
      boundaryPointToward(source, sourceLayout, average)
    : distributedSourcePoint ??
      boundaryPointToward(
        source,
        sourceLayout,
        center(targets[0].layout),
      );
  const fork = shared
    ? offsetPoint(
        sourcePoint,
        side,
        trunkLength(
          sourceLayout,
          targets.map((item) => item.layout),
          side,
        ),
      )
    : sourcePoint;
  const trunk = shared
    ? buildForwardCurve(sourcePoint, fork)
    : undefined;

  const routes = targets.map((item, index): EdgeRoute => {
    const start = sourcePoint;
    const targetPoint =
      distributedTargetPoints[item.edge.id] ??
      boundaryPointToward(item.node, item.layout, start);
    const targetSide = sideToward(item.layout, start);
    const armStart = shared ? fork : start;
    const arm = buildCurve(
      armStart,
      targetPoint,
      shared ? side : sideToward(sourceLayout, targetPoint),
      targetSide,
    );
    const midpoint = {
      x: (armStart.x + targetPoint.x) / 2,
      y: (armStart.y + targetPoint.y) / 2 - 6,
    };
    const armLength = Math.max(
      1,
      Math.hypot(
        targetPoint.x - armStart.x,
        targetPoint.y - armStart.y,
      ),
    );
    const spread =
      edges.length > 1 ? (index - (edges.length - 1) / 2) * 14 : 0;
    const segments = trunk ? [trunk, arm] : [arm];
    return {
      edgeId: item.edge.id,
      sourceId: source.id,
      targetId: item.edge.target,
      bundleId: bundle?.id,
      sourcePoint: start,
      forkPoint: fork,
      targetPoint,
      trunkPath: trunk ? curvePath(trunk) : "",
      armPath: arm.command,
      control1: arm.control1,
      control2: arm.control2,
      path: trunk
        ? `${curvePath(trunk)} ${arm.command}`
        : curvePath(arm),
      segments,
      hitPoints: segments.flatMap((segment, segmentIndex) =>
        curveSamples(segment, 12).slice(segmentIndex === 0 ? 0 : 1),
      ),
      labelPoint: {
        x:
          midpoint.x +
          (-(targetPoint.y - armStart.y) / armLength) * spread,
        y:
          midpoint.y +
          ((targetPoint.x - armStart.x) / armLength) * spread,
      },
      side,
      important: Boolean(item.edge.important),
    };
  });

  if (!bundle || routes.length < 2) return { routes };
  const rawLabelPoint = {
    x: (sourcePoint.x + fork.x) / 2,
    y: (sourcePoint.y + fork.y) / 2 - 12,
  };
  const labelPoint =
    Number.isFinite(rawLabelPoint.x) && Number.isFinite(rawLabelPoint.y)
      ? rawLabelPoint
      : { x: fork.x, y: fork.y - 12 };
  return {
    routes,
    branch: {
      id: bundle.id,
      bundleId: bundle.id,
      sourceId: source.id,
      point: fork,
      labelPoint,
      label: bundle.label,
      visible: bundle.visible,
      edgeIds: routes.map((route) => route.edgeId),
      side,
      trunkPath: routes[0].trunkPath,
    },
  };
}

export function buildWorkflowRouting(
  document: WorkflowDocument,
  visibleNodeIds?: Set<string>,
  cache?: RoutingCache,
): WorkflowRouting {
  const edges = visibleEdges(document, visibleNodeIds);
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]));
  // Legacy bundle records remain readable, but edges are never merged visually.
  const bundles: Array<{
    bundle: WorkflowBundle;
    members: WorkflowEdge[];
  }> = [];
  const bundledIds = new Set(
    bundles.flatMap((item) => item.members.map((edge) => edge.id)),
  );
  const groups = [
    ...bundles.map(({ bundle, members }) => ({
      key: `bundle:${bundle.id}`,
      sourceId: bundle.sourceId,
      edges: members,
      bundle,
    })),
    ...edges
      .filter((edge) => !bundledIds.has(edge.id))
      .map((edge) => ({
        key: `edge:${edge.id}`,
        sourceId: edge.source,
        edges: [edge],
        bundle: undefined,
      })),
  ];
  const sourcePoints: Record<string, Point> = {};
  const groupsBySource = new Map<
    string,
    typeof groups
  >();
  for (const group of groups) {
    const entries = groupsBySource.get(group.sourceId) ?? [];
    entries.push(group);
    groupsBySource.set(group.sourceId, entries);
  }
  for (const [sourceId, sourceGroups] of groupsBySource) {
    const source = document.nodes.find((node) => node.id === sourceId);
    const sourceLayout = document.layout.nodes[sourceId];
    if (!source || !sourceLayout) continue;
    const anchors = sourceGroups.map((group) => {
      const targetLayouts = group.edges
        .map((edge) => document.layout.nodes[edge.target])
        .filter((layout): layout is NodeRect => Boolean(layout));
      const point =
        targetLayouts.length > 0
          ? {
              x:
                targetLayouts.reduce(
                  (sum, layout) => sum + center(layout).x,
                  0,
                ) / targetLayouts.length,
              y:
                targetLayouts.reduce(
                  (sum, layout) => sum + center(layout).y,
                  0,
                ) / targetLayouts.length,
            }
          : center(sourceLayout);
      return { key: group.key, point };
    });
    Object.assign(
      sourcePoints,
      distributeBoundaryPoints(source, sourceLayout, anchors),
    );
  }
  const edgeToGroupKey = new Map(
    groups.flatMap((group) =>
      group.edges.map((edge) => [edge.id, group.key] as const),
    ),
  );
  const targetCandidates = new Map<
    string,
    Array<{ key: string; point: Point }>
  >();
  for (const edge of edges) {
    const sourcePoint = sourcePoints[edgeToGroupKey.get(edge.id) ?? ""];
    if (!sourcePoint) continue;
    const candidates = targetCandidates.get(edge.target) ?? [];
    candidates.push({ key: edge.id, point: sourcePoint });
    targetCandidates.set(edge.target, candidates);
  }
  const targetPoints: Record<string, Point> = {};
  for (const [targetId, candidates] of targetCandidates) {
    const target = document.nodes.find((node) => node.id === targetId);
    const targetLayout = document.layout.nodes[targetId];
    if (!target || !targetLayout) continue;
    Object.assign(
      targetPoints,
      distributeBoundaryPoints(target, targetLayout, candidates),
    );
  }

  const routes: Record<string, EdgeRoute> = {};
  const branches: Record<string, BranchPoint> = {};
  let cacheHits = 0;
  for (const group of groups) {
    const source = document.nodes.find((node) => node.id === group.sourceId);
    const sourceLayout = document.layout.nodes[group.sourceId];
    if (!source || !sourceLayout) continue;
    const signature = groupSignature(
      source,
      sourceLayout,
      group.edges,
      group.bundle,
      document,
    );
    const cached = cache?.get(group.key);
    const result =
      cached?.signature === signature
        ? cached
        : buildEdgeGroup(
            source,
            sourceLayout,
            group.edges,
            document,
            group.bundle,
            sourcePoints[group.key],
            targetPoints,
          );
    if (cached?.signature === signature) cacheHits += 1;
    cache?.set(group.key, { signature, ...result });
    result.routes.forEach((route) => {
      routes[route.edgeId] = route;
    });
    if (result.branch) branches[result.branch.id] = result.branch;
  }
  return { routes, branches, cacheHits };
}

export function distanceToRoute(point: Point, route: EdgeRoute): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 0; index < route.hitPoints.length - 1; index += 1) {
    const start = route.hitPoints[index];
    const end = route.hitPoints[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const lengthSquared = dx * dx + dy * dy;
    const projection =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.y - start.y) * dy) /
                lengthSquared,
            ),
          );
    minimum = Math.min(
      minimum,
      Math.hypot(
        point.x - (start.x + projection * dx),
        point.y - (start.y + projection * dy),
      ),
    );
  }
  return minimum;
}

export interface ConnectionPreview {
  path: string;
  sourcePoint: Point;
  endPoint: Point;
  side: RouteSide;
}

export function buildConnectionPreview(
  document: WorkflowDocument,
  sourceId: string,
  pointer: Point,
  targetId?: string | null,
): ConnectionPreview | null {
  const source = document.nodes.find((node) => node.id === sourceId);
  const sourceLayout = document.layout.nodes[sourceId];
  if (!source || !sourceLayout) return null;
  const side = sideToward(sourceLayout, pointer);
  const sourcePoint = boundaryPointToward(source, sourceLayout, pointer);
  const target = targetId
    ? document.nodes.find((node) => node.id === targetId)
    : undefined;
  const targetLayout = targetId ? document.layout.nodes[targetId] : undefined;
  const endPoint =
    target && targetLayout
      ? boundaryPointToward(target, targetLayout, sourcePoint)
      : pointer;
  const endSide =
    target && targetLayout
      ? sideToward(targetLayout, sourcePoint)
      : oppositeSide(side);
  const curve = buildCurve(sourcePoint, endPoint, side, endSide);
  return {
    path: curvePath(curve),
    sourcePoint,
    endPoint,
    side,
  };
}

export function buildFreePreviewPath(
  start: Point,
  end: Point,
  side: RouteSide = "right",
): string {
  return curvePath(buildCurve(start, end, side, oppositeSide(side)));
}

function cubicPoint(
  start: Point,
  control1: Point,
  control2: Point,
  end: Point,
  t: number,
): Point {
  const inverse = 1 - t;
  return {
    x:
      inverse ** 3 * start.x +
      3 * inverse ** 2 * t * control1.x +
      3 * inverse * t ** 2 * control2.x +
      t ** 3 * end.x,
    y:
      inverse ** 3 * start.y +
      3 * inverse ** 2 * t * control1.y +
      3 * inverse * t ** 2 * control2.y +
      t ** 3 * end.y,
  };
}

export function sampleRoute(route: EdgeRoute, steps = 20): Point[] {
  const perSegment = Math.max(
    4,
    Math.ceil(steps / Math.max(1, route.segments.length)),
  );
  return route.segments.flatMap((segment, index) =>
    curveSamples(segment, perSegment).slice(index === 0 ? 0 : 1),
  );
}

export function routeIntersectsRect(
  route: EdgeRoute,
  rect: NodeRect,
  inset = 2,
): boolean {
  // Boundary ports can sit inside an ellipse's rectangular bounds. Exclude
  // the exact endpoints so this checks the routed body rather than the port.
  return sampleRoute(route).slice(1, -1).some(
    (point) =>
      point.x > rect.x + inset &&
      point.x < rect.x + rect.width - inset &&
      point.y > rect.y + inset &&
      point.y < rect.y + rect.height - inset,
  );
}

export function routeIntersectsNode(
  route: EdgeRoute,
  node: WorkflowNode,
  layout: NodeRect,
  inset = 2,
): boolean {
  return sampleRoute(route)
    .slice(1, -1)
    .some((point) => nodeContainsPoint(node, layout, point, inset));
}

export function routePointAt(route: EdgeRoute, progress: number): Point {
  const points = sampleRoute(route, 32);
  const index = Math.max(0, Math.min(1, progress)) * (points.length - 1);
  const lower = Math.floor(index);
  const upper = Math.min(points.length - 1, lower + 1);
  const mix = index - lower;
  return {
    x: points[lower].x + (points[upper].x - points[lower].x) * mix,
    y: points[lower].y + (points[upper].y - points[lower].y) * mix,
  };
}

export function projectPointOntoRoute(
  point: Point,
  route: EdgeRoute,
  steps = 96,
): { point: Point; progress: number; distance: number } {
  const points = sampleRoute(route, steps);
  const segmentLengths: number[] = [];
  let total = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const length = Math.hypot(
      points[index + 1].x - points[index].x,
      points[index + 1].y - points[index].y,
    );
    segmentLengths.push(length);
    total += length;
  }

  let best = {
    point: points[0],
    progress: 0,
    distance: Number.POSITIVE_INFINITY,
  };
  let travelled = 0;
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = segmentLengths[index];
    const lengthSquared = length * length;
    const projection =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * dx + (point.y - start.y) * dy) /
                lengthSquared,
            ),
          );
    const projected = {
      x: start.x + dx * projection,
      y: start.y + dy * projection,
    };
    const distance = Math.hypot(
      point.x - projected.x,
      point.y - projected.y,
    );
    if (distance < best.distance) {
      best = {
        point: projected,
        progress:
          total === 0
            ? 0
            : (travelled + length * projection) / total,
        distance,
      };
    }
    travelled += length;
  }
  return best;
}

export function progressAlongRoute(point: Point, route: EdgeRoute): number {
  return projectPointOntoRoute(point, route, 48).progress;
}
