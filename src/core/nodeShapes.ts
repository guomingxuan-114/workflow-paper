import type {
  NodeLayout,
  Point,
  WorkflowNode,
} from "./types";

export type NodeShapeKind =
  | "rounded"
  | "ellipse"
  | "capsule"
  | "note";

export interface NodeMetrics {
  shape: NodeShapeKind;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  textInsetX: number;
  textInsetY: number;
}

export const GRID_SIZE = 10;

export function nodeShapeKind(node: WorkflowNode): NodeShapeKind {
  if (node.type === "decision") return "ellipse";
  if (
    node.type === "start" ||
    node.type === "fork" ||
    node.type === "end"
  ) {
    return "capsule";
  }
  if (node.type === "note") return "note";
  return "rounded";
}

export function nodeMetrics(node: WorkflowNode): NodeMetrics {
  const shape = nodeShapeKind(node);
  if (shape === "ellipse") {
    return {
      shape,
      width: 252,
      height: 136,
      minWidth: 180,
      minHeight: 104,
      textInsetX: 52,
      textInsetY: 34,
    };
  }
  if (node.type === "fork") {
    return {
      shape,
      width: 44,
      height: 28,
      minWidth: 36,
      minHeight: 24,
      textInsetX: 7,
      textInsetY: 4,
    };
  }
  if (shape === "capsule") {
    return {
      shape,
      width: 268,
      height: 132,
      minWidth: 200,
      minHeight: 96,
      textInsetX: 42,
      textInsetY: 22,
    };
  }
  if (shape === "note") {
    return {
      shape,
      width: 224,
      height: 126,
      minWidth: 160,
      minHeight: 92,
      textInsetX: 18,
      textInsetY: 24,
    };
  }
  const emphasized = Boolean(node.milestone || node.important);
  return {
    shape,
    width: emphasized ? 236 : 224,
    height: emphasized ? 116 : 106,
    minWidth: 150,
    minHeight: 82,
    textInsetX: 18,
    textInsetY: 16,
  };
}

export function snapNodeSize(width: number, height: number) {
  return {
    width: Math.max(1, Math.round(width / GRID_SIZE) * GRID_SIZE),
    height: Math.max(1, Math.round(height / GRID_SIZE) * GRID_SIZE),
  };
}

export function localShapePoints(
  node: WorkflowNode,
  width: number,
  height: number,
): Point[] {
  const shape = nodeShapeKind(node);
  const points: Point[] = [];
  const center = { x: width / 2, y: height / 2 };
  if (shape === "ellipse") {
    for (let index = 0; index < 72; index += 1) {
      const angle = (Math.PI * 2 * index) / 72;
      points.push({
        x: center.x + Math.cos(angle) * (width / 2),
        y: center.y + Math.sin(angle) * (height / 2),
      });
    }
    return points;
  }
  if (shape === "note") {
    return [
      { x: 0, y: 0 },
      { x: width - 20, y: 0 },
      { x: width, y: 20 },
      { x: width, y: height },
      { x: 0, y: height },
    ];
  }

  const radius =
    shape === "capsule"
      ? height / 2
      : Math.min(12, width / 2, height / 2);
  const corners = [
    { x: width - radius, y: radius, start: -Math.PI / 2 },
    { x: width - radius, y: height - radius, start: 0 },
    { x: radius, y: height - radius, start: Math.PI / 2 },
    { x: radius, y: radius, start: Math.PI },
  ];
  for (const corner of corners) {
    for (let step = 0; step <= 8; step += 1) {
      const angle = corner.start + (Math.PI / 2) * (step / 8);
      points.push({
        x: corner.x + Math.cos(angle) * radius,
        y: corner.y + Math.sin(angle) * radius,
      });
    }
  }
  return points;
}

export function nodeBoundaryPath(
  node: WorkflowNode,
  width: number,
  height: number,
): string {
  const shape = nodeShapeKind(node);
  if (shape === "ellipse") {
    return `M ${width} ${height / 2} A ${width / 2} ${height / 2} 0 1 1 0 ${height / 2} A ${width / 2} ${height / 2} 0 1 1 ${width} ${height / 2} Z`;
  }
  if (shape === "note") {
    return `M 0 0 L ${width - 20} 0 L ${width} 20 L ${width} ${height} L 0 ${height} Z`;
  }
  const radius =
    shape === "capsule"
      ? height / 2
      : Math.min(12, width / 2, height / 2);
  return `M ${radius} 0 H ${width - radius} A ${radius} ${radius} 0 0 1 ${width} ${radius} V ${height - radius} A ${radius} ${radius} 0 0 1 ${width - radius} ${height} H ${radius} A ${radius} ${radius} 0 0 1 0 ${height - radius} V ${radius} A ${radius} ${radius} 0 0 1 ${radius} 0 Z`;
}

function rayPolygonIntersection(
  origin: Point,
  direction: Point,
  points: Point[],
): Point {
  let best = Number.POSITIVE_INFINITY;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    const edge = { x: b.x - a.x, y: b.y - a.y };
    const denominator =
      direction.x * edge.y - direction.y * edge.x;
    if (Math.abs(denominator) < 1e-8) continue;
    const offset = { x: a.x - origin.x, y: a.y - origin.y };
    const t = (offset.x * edge.y - offset.y * edge.x) / denominator;
    const u =
      (offset.x * direction.y - offset.y * direction.x) / denominator;
    if (t >= 0 && u >= 0 && u <= 1) best = Math.min(best, t);
  }
  if (!Number.isFinite(best)) {
    return {
      x: origin.x + direction.x,
      y: origin.y + direction.y,
    };
  }
  return {
    x: origin.x + direction.x * best,
    y: origin.y + direction.y * best,
  };
}

export function boundaryPointToward(
  node: WorkflowNode,
  layout: NodeLayout,
  target: Point,
): Point {
  const center = {
    x: layout.width / 2,
    y: layout.height / 2,
  };
  const toward = {
    x: target.x - (layout.x + center.x),
    y: target.y - (layout.y + center.y),
  };
  const length = Math.max(0.001, Math.hypot(toward.x, toward.y));
  const direction = {
    x: toward.x / length,
    y: toward.y / length,
  };
  const local = rayPolygonIntersection(
    center,
    direction,
    localShapePoints(node, layout.width, layout.height),
  );
  return { x: layout.x + local.x, y: layout.y + local.y };
}

export function nodeContainsPoint(
  node: WorkflowNode,
  layout: NodeLayout,
  point: Point,
  inset = 0,
): boolean {
  const x = point.x - layout.x;
  const y = point.y - layout.y;
  if (x <= inset || x >= layout.width - inset) return false;
  if (y <= inset || y >= layout.height - inset) return false;
  const shape = nodeShapeKind(node);
  const center = { x: layout.width / 2, y: layout.height / 2 };
  if (shape === "ellipse") {
    const radiusX = Math.max(1, layout.width / 2 - inset);
    const radiusY = Math.max(1, layout.height / 2 - inset);
    return (
      ((x - center.x) / radiusX) ** 2 +
        ((y - center.y) / radiusY) ** 2 <
      1
    );
  }
  if (shape === "capsule") {
    const radius = Math.max(1, layout.height / 2 - inset);
    if (
      x >= radius &&
      x <= layout.width - radius &&
      Math.abs(y - center.y) < radius
    ) {
      return true;
    }
    const leftDistance = Math.hypot(x - radius, y - center.y);
    const rightDistance = Math.hypot(
      x - (layout.width - radius),
      y - center.y,
    );
    return x < center.x ? leftDistance < radius : rightDistance < radius;
  }
  return true;
}

export function distributeBoundaryPoints(
  node: WorkflowNode,
  layout: NodeLayout,
  targets: Array<{ key: string; point: Point }>,
  minAngleDegrees = 12,
): Record<string, Point> {
  if (targets.length <= 1) {
    return Object.fromEntries(
      targets.map(({ key, point }) => [
        key,
        boundaryPointToward(node, layout, point),
      ]),
    );
  }
  const center = {
    x: layout.x + layout.width / 2,
    y: layout.y + layout.height / 2,
  };
  const minAngle = (Math.PI * minAngleDegrees) / 180;
  const sorted = targets
    .map((target) => ({
      ...target,
      angle: Math.atan2(target.point.y - center.y, target.point.x - center.x),
    }))
    .sort((a, b) => a.angle - b.angle);

  for (let index = 1; index < sorted.length; index += 1) {
    sorted[index].angle = Math.max(
      sorted[index].angle,
      sorted[index - 1].angle + minAngle,
    );
  }
  const first = sorted[0].angle;
  const last = sorted[sorted.length - 1].angle;
  if (last - first > Math.PI * 2 - minAngle) {
    const spacing = (Math.PI * 2) / sorted.length;
    sorted.forEach((entry, index) => {
      entry.angle = first + spacing * index;
    });
  }

  const radius = Math.hypot(layout.width, layout.height);
  return Object.fromEntries(
    sorted.map((entry) => [
      entry.key,
      boundaryPointToward(node, layout, {
        x: center.x + Math.cos(entry.angle) * radius,
        y: center.y + Math.sin(entry.angle) * radius,
      }),
    ]),
  );
}
