import { getHiddenNodeIds } from "./document";
import type {
  Point,
  WorkflowDocument,
  WorkflowEdge,
  WorkflowLayout,
} from "./types";

export type RouteSide = "left" | "right" | "top" | "bottom";

export interface EdgeRoute {
  edgeId: string;
  sourceId: string;
  targetId: string;
  sourcePoint: Point;
  forkPoint: Point;
  targetPoint: Point;
  trunkPath: string;
  armPath: string;
  control1: Point;
  control2: Point;
  path: string;
  hitPoints: Point[];
  labelPoint: Point;
  side: RouteSide;
}

export interface BranchPoint {
  id: string;
  sourceId: string;
  point: Point;
  edgeIds: string[];
  side: RouteSide;
}

export interface WorkflowRouting {
  routes: Record<string, EdgeRoute>;
  branches: Record<string, BranchPoint>;
}

type NodeRect = WorkflowLayout["nodes"][string];

function center(rect: NodeRect): Point {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sourceSide(rect: NodeRect, target: Point): RouteSide {
  const origin = center(rect);
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}

function pointOnSide(rect: NodeRect, side: RouteSide, along?: number): Point {
  if (side === "left" || side === "right") {
    return {
      x: side === "left" ? rect.x : rect.x + rect.width,
      y: clamp(along ?? rect.y + rect.height / 2, rect.y + 14, rect.y + rect.height - 14),
    };
  }
  return {
    x: clamp(along ?? rect.x + rect.width / 2, rect.x + 16, rect.x + rect.width - 16),
    y: side === "top" ? rect.y : rect.y + rect.height,
  };
}

function trunkLength(
  source: NodeRect,
  targets: NodeRect[],
  side: RouteSide,
): number {
  const sourceCenter = center(source);
  const gaps = targets.map((rect) => {
    if (side === "right") return rect.x - (source.x + source.width);
    if (side === "left") return source.x - (rect.x + rect.width);
    if (side === "bottom") return rect.y - (source.y + source.height);
    return source.y - (rect.y + rect.height);
  });
  const directDistance = Math.hypot(
    sourceCenter.x - center(targets[0]).x,
    sourceCenter.y - center(targets[0]).y,
  );
  const positiveGaps = gaps.filter((value) => value > 0);
  const available =
    positiveGaps.length > 0 ? Math.min(...positiveGaps) : directDistance;
  return Math.max(
    18,
    Math.min(78, available * 0.45),
  );
}

function offsetPoint(point: Point, side: RouteSide, length: number): Point {
  if (side === "left") return { x: point.x - length, y: point.y };
  if (side === "right") return { x: point.x + length, y: point.y };
  if (side === "top") return { x: point.x, y: point.y - length };
  return { x: point.x, y: point.y + length };
}

function targetPointFor(rect: NodeRect, from: Point): { point: Point; side: RouteSide } {
  const origin = center(rect);
  const dx = from.x - origin.x;
  const dy = from.y - origin.y;
  const side: RouteSide =
    Math.abs(dx) >= Math.abs(dy)
      ? dx <= 0
        ? "left"
        : "right"
      : dy <= 0
        ? "top"
        : "bottom";
  const along =
    side === "left" || side === "right"
      ? clamp(from.y, rect.y + 16, rect.y + rect.height - 16)
      : clamp(from.x, rect.x + 16, rect.x + rect.width - 16);
  return { point: pointOnSide(rect, side, along), side };
}

function armSegment(
  from: Point,
  to: Point,
  fromSide: RouteSide,
): { path: string; control1: Point; control2: Point } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (fromSide === "left" || fromSide === "right") {
    const bend = Math.max(28, Math.abs(dx) * 0.42);
    const direction = fromSide === "right" ? 1 : -1;
    const control1 = { x: from.x + direction * bend, y: from.y };
    const control2 = { x: to.x - direction * bend, y: to.y };
    return {
      path: `C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${to.x} ${to.y}`,
      control1,
      control2,
    };
  }
  const bend = Math.max(28, Math.abs(dy) * 0.42);
  const direction = fromSide === "bottom" ? 1 : -1;
  const control1 = { x: from.x, y: from.y + direction * bend };
  const control2 = { x: to.x, y: to.y - direction * bend };
  return {
    path: `C ${control1.x} ${control1.y}, ${control2.x} ${control2.y}, ${to.x} ${to.y}`,
    control1,
    control2,
  };
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

function buildSourceGroup(
  sourceId: string,
  side: RouteSide,
  edges: WorkflowEdge[],
  layout: WorkflowLayout,
): { routes: EdgeRoute[]; branch?: BranchPoint } {
  const source = layout.nodes[sourceId];
  const targets = edges
    .map((edge) => layout.nodes[edge.target])
    .filter((rect): rect is NodeRect => Boolean(rect));
  if (!source || targets.length === 0) return { routes: [] };

  const averageTarget = {
    x: targets.reduce((sum, rect) => sum + center(rect).x, 0) / targets.length,
    y: targets.reduce((sum, rect) => sum + center(rect).y, 0) / targets.length,
  };
  const along =
    side === "left" || side === "right" ? averageTarget.y : averageTarget.x;
  const exit = pointOnSide(source, side, along);
  const fork = offsetPoint(exit, side, trunkLength(source, targets, side));

  const routes = edges.map((edge, index): EdgeRoute => {
    const targetRect = layout.nodes[edge.target];
    const target = targetPointFor(targetRect, fork);
    const arm = armSegment(fork, target.point, side);
    const midpoint = {
      x: (fork.x + target.point.x) / 2,
      y: (fork.y + target.point.y) / 2 - (target.side === "bottom" ? 0 : 6),
    };
    const armLength = Math.max(
      1,
      Math.hypot(target.point.x - fork.x, target.point.y - fork.y),
    );
    const spread =
      edges.length > 1 ? (index - (edges.length - 1) / 2) * 13 : 0;
    const labelPoint = {
      x:
        midpoint.x +
        (-(target.point.y - fork.y) / armLength) * spread,
      y:
        midpoint.y +
        ((target.point.x - fork.x) / armLength) * spread,
    };
    return {
      edgeId: edge.id,
      sourceId,
      targetId: edge.target,
      sourcePoint: exit,
      forkPoint: fork,
      targetPoint: target.point,
      trunkPath: `M ${exit.x} ${exit.y} L ${fork.x} ${fork.y}`,
      armPath: arm.path,
      control1: arm.control1,
      control2: arm.control2,
      path: `M ${exit.x} ${exit.y} L ${fork.x} ${fork.y} ${arm.path}`,
      hitPoints: [exit, fork, target.point],
      labelPoint,
      side,
    };
  });

  return {
    routes,
    ...(edges.length > 1
      ? {
          branch: {
            id: `${sourceId}:${side}`,
            sourceId,
            point: fork,
            edgeIds: edges.map((edge) => edge.id),
            side,
          },
        }
      : {}),
  };
}

export function buildWorkflowRouting(
  document: WorkflowDocument,
  visibleNodeIds?: Set<string>,
): WorkflowRouting {
  const groups = new Map<string, { sourceId: string; side: RouteSide; edges: WorkflowEdge[] }>();
  for (const edge of visibleEdges(document, visibleNodeIds)) {
    const source = document.layout.nodes[edge.source];
    const target = document.layout.nodes[edge.target];
    if (!source || !target) continue;
    const side = sourceSide(source, center(target));
    const key = `${edge.source}:${side}`;
    const group = groups.get(key) ?? { sourceId: edge.source, side, edges: [] };
    group.edges.push(edge);
    groups.set(key, group);
  }

  const routes: Record<string, EdgeRoute> = {};
  const branches: Record<string, BranchPoint> = {};
  for (const group of groups.values()) {
    const result = buildSourceGroup(
      group.sourceId,
      group.side,
      group.edges,
      document.layout,
    );
    for (const route of result.routes) routes[route.edgeId] = route;
    if (result.branch) branches[result.branch.id] = result.branch;
  }
  return { routes, branches };
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

export function branchEdges(
  document: WorkflowDocument,
  sourceId: string,
): WorkflowEdge[] {
  return document.edges.filter((edge) => edge.source === sourceId);
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
  const source = document.layout.nodes[sourceId];
  if (!source) return null;
  const side = sourceSide(source, pointer);
  const sourcePoint = pointOnSide(
    source,
    side,
    side === "left" || side === "right" ? pointer.y : pointer.x,
  );
  const target = targetId ? document.layout.nodes[targetId] : undefined;
  const endPoint = target
    ? targetPointFor(target, sourcePoint).point
    : pointer;
  const arm = armSegment(sourcePoint, endPoint, side);
  return {
    path: `M ${sourcePoint.x} ${sourcePoint.y} ${arm.path}`,
    sourcePoint,
    endPoint,
    side,
  };
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
  const points: Point[] = [];
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps;
    points.push({
      x: route.sourcePoint.x + (route.forkPoint.x - route.sourcePoint.x) * t,
      y: route.sourcePoint.y + (route.forkPoint.y - route.sourcePoint.y) * t,
    });
  }
  for (let index = 0; index <= steps; index += 1) {
    points.push(
      cubicPoint(
        route.forkPoint,
        route.control1,
        route.control2,
        route.targetPoint,
        index / steps,
      ),
    );
  }
  return points;
}

export function routeIntersectsRect(
  route: EdgeRoute,
  rect: NodeRect,
  inset = 2,
): boolean {
  return sampleRoute(route).some(
    (point) =>
      point.x > rect.x + inset &&
      point.x < rect.x + rect.width - inset &&
      point.y > rect.y + inset &&
      point.y < rect.y + rect.height - inset,
  );
}
