"use client";

import { useEffect, useRef, useState } from "react";

interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17],
];

const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_TIP = 20;
const INDEX_PINCH_THRESHOLD = 15;
const MIDDLE_PINCH_THRESHOLD = 30;
const RING_PINCH_THRESHOLD = 15;
const PINKY_PINCH_THRESHOLD = 55;
const PINCH_RELEASE_PADDING = 5;
const HAND_SCALE_REFERENCE_SIZE = 90;
const MIN_PINCH_SCALE = 0.5;
const MAX_PINCH_SCALE = 3;
const FIST_CLEAR_DURATION_MS = 3000;
const CORNER_HIT_SIZE = 72;
const MIN_SHAPE_SIZE = 40;
const SCREEN_MARGIN = 0;
const MIN_SHAPE_Z = 0;
const MAX_SHAPE_Z = 50;
const GESTURE_SMOOTHING = 0.28;
const GESTURE_DEADZONE = 6;
const Z_DEPTH_SENSITIVITY = 2000;
const HAND_TRACKING_OVERSCAN = 0.05;
const SHAPES_COOKIE_NAME = "dimensional-playground-shapes";
const SHAPES_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
const TRIANGLE_TOP_X = 0.5;
const TRIANGLE_TOP_Y = 0.08;
const TRIANGLE_BOTTOM_LEFT_X = 0.08;
const TRIANGLE_BOTTOM_RIGHT_X = 0.92;
const TRIANGLE_BOTTOM_Y = 0.95;
const TRIANGLE_MIN_POINT_SPAN = 24;
const TRIANGLE_PADDING = 16;

type ResizeHandle = "top-left" | "top-right" | "bottom-left" | "bottom-right" | "top" | "right";
type ShapeType = "rectangle" | "circle" | "triangle";
type ToolbarAction = ShapeType;
type PinchFinger = "index" | "middle" | "ring" | "pinky";
type ShapeStyle = React.CSSProperties & {
  "--shape-brightness": string;
  "--shape-ground-shadow-opacity": string;
  "--shape-ground-shadow-scale": string;
  "--shape-ground-shadow-y": string;
  "--shape-shadow-alpha": string;
  "--shape-shadow-blur": string;
  "--shape-shadow-y": string;
};
type ActiveGesture =
  | { type: "resize"; handle: ResizeHandle; shapeId: number }
  | { type: "move"; shapeId: number };
type PinchPoint = { x: number; y: number; z: number };
type ResizeHandlePoint = { handle: ResizeHandle; x: number; y: number; localX?: number; localY?: number };
type TrianglePoint = { x: number; y: number };
type TrianglePoints = [TrianglePoint, TrianglePoint, TrianglePoint];

interface Shape {
  id: number;
  type: ShapeType;
  left: number;
  top: number;
  width: number;
  height: number;
  z: number;
  trianglePoints?: TrianglePoints;
}

interface HandTrackingProps {
  onReplayTutorial?: () => void;
  onTutorialGesture?: (gesture: TutorialGesture) => void;
}

export type TutorialGesture = "drag" | "resize" | "zoom" | "depth" | "duplicate" | "delete" | "clear";

function isShapeType(value: unknown): value is ShapeType {
  return value === "rectangle" || value === "circle" || value === "triangle";
}

function isTrianglePoint(value: unknown): value is TrianglePoint {
  if (!value || typeof value !== "object") return false;

  const point = value as Partial<TrianglePoint>;
  return typeof point.x === "number" && typeof point.y === "number";
}

function isTrianglePoints(value: unknown): value is TrianglePoints {
  return Array.isArray(value) && value.length === 3 && value.every(isTrianglePoint);
}

function isSavedShape(value: unknown): value is Shape {
  if (!value || typeof value !== "object") return false;

  const shape = value as Partial<Shape>;
  return (
    typeof shape.id === "number" &&
    isShapeType(shape.type) &&
    typeof shape.left === "number" &&
    typeof shape.top === "number" &&
    typeof shape.width === "number" &&
    typeof shape.height === "number" &&
    typeof shape.z === "number" &&
    (shape.trianglePoints === undefined || isTrianglePoints(shape.trianglePoints))
  );
}

function readShapesCookie() {
  if (typeof document === "undefined") return [];

  const cookie = document.cookie
    .split("; ")
    .find((cookiePart) => cookiePart.startsWith(`${SHAPES_COOKIE_NAME}=`));
  if (!cookie) return [];

  try {
    const savedShapes = JSON.parse(decodeURIComponent(cookie.split("=").slice(1).join("=")));
    return Array.isArray(savedShapes) ? savedShapes.filter(isSavedShape) : [];
  } catch {
    return [];
  }
}

function writeShapesCookie(shapes: Shape[]) {
  if (typeof document === "undefined") return;

  document.cookie = `${SHAPES_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(shapes))}; max-age=${SHAPES_COOKIE_MAX_AGE}; path=/; same-site=lax`;
}

function areNumberArraysEqual(first: number[], second: number[]) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

function getShapeDepthScale(shape: Shape) {
  const zProgress = (shape.z - MIN_SHAPE_Z) / (MAX_SHAPE_Z - MIN_SHAPE_Z);
  return 1 + zProgress * 0.4;
}

function getDefaultTrianglePoints(width: number, height: number): TrianglePoints {
  return [
    { x: width * TRIANGLE_TOP_X, y: height * TRIANGLE_TOP_Y },
    { x: width * TRIANGLE_BOTTOM_LEFT_X, y: height * TRIANGLE_BOTTOM_Y },
    { x: width * TRIANGLE_BOTTOM_RIGHT_X, y: height * TRIANGLE_BOTTOM_Y },
  ];
}

function getTrianglePoints(shape: Shape): TrianglePoints {
  return shape.trianglePoints ?? getDefaultTrianglePoints(shape.width, shape.height);
}

function getTrianglePointForHandle(shape: Shape, handle: ResizeHandle) {
  const [top, bottomLeft, bottomRight] = getTrianglePoints(shape);

  if (handle === "top") return top;
  if (handle === "bottom-left") return bottomLeft;
  if (handle === "bottom-right") return bottomRight;
  return null;
}

function getVisualTrianglePoint(shape: Shape, point: TrianglePoint) {
  const depthScale = getShapeDepthScale(shape);
  const centerX = shape.left + shape.width / 2;
  const centerY = shape.top + shape.height / 2;

  return {
    x: centerX + (point.x - shape.width / 2) * depthScale,
    y: centerY + (point.y - shape.height / 2) * depthScale,
  };
}

function normalizeTriangleShape(
  shape: Shape,
  trianglePoints: TrianglePoints,
  anchorPointIndex?: number,
  anchorVisualPoint?: { x: number; y: number }
): Shape {
  const minX = Math.min(...trianglePoints.map((point) => point.x));
  const minY = Math.min(...trianglePoints.map((point) => point.y));
  const maxX = Math.max(...trianglePoints.map((point) => point.x));
  const maxY = Math.max(...trianglePoints.map((point) => point.y));
  const nextWidth = maxX - minX + TRIANGLE_PADDING * 2;
  const nextHeight = maxY - minY + TRIANGLE_PADDING * 2;

  if (
    maxX - minX < TRIANGLE_MIN_POINT_SPAN ||
    maxY - minY < TRIANGLE_MIN_POINT_SPAN
  ) {
    return shape;
  }

  const nextTrianglePoints = trianglePoints.map((point) => ({
    x: point.x - minX + TRIANGLE_PADDING,
    y: point.y - minY + TRIANGLE_PADDING,
  })) as TrianglePoints;
  let nextLeft = shape.left + minX - TRIANGLE_PADDING;
  let nextTop = shape.top + minY - TRIANGLE_PADDING;

  if (
    anchorPointIndex !== undefined &&
    anchorVisualPoint &&
    nextTrianglePoints[anchorPointIndex]
  ) {
    const depthScale = getShapeDepthScale(shape);
    const anchorPoint = nextTrianglePoints[anchorPointIndex];

    nextLeft = anchorVisualPoint.x - depthScale * anchorPoint.x - (1 - depthScale) * nextWidth / 2;
    nextTop = anchorVisualPoint.y - depthScale * anchorPoint.y - (1 - depthScale) * nextHeight / 2;
  }

  return {
    ...shape,
    left: nextLeft,
    top: nextTop,
    width: nextWidth,
    height: nextHeight,
    trianglePoints: nextTrianglePoints,
  };
}

function getTrianglePath(shape: Shape) {
  const [top, bottomLeft, bottomRight] = getTrianglePoints(shape);
  return `M ${top.x} ${top.y} L ${bottomRight.x} ${bottomRight.y} L ${bottomLeft.x} ${bottomLeft.y} Z`;
}

function isPointInTriangle(point: { x: number; y: number }, triangle: TrianglePoints) {
  const [a, b, c] = triangle;
  const area = Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y));
  const areaA = Math.abs((a.x - point.x) * (b.y - point.y) - (b.x - point.x) * (a.y - point.y));
  const areaB = Math.abs((b.x - point.x) * (c.y - point.y) - (c.x - point.x) * (b.y - point.y));
  const areaC = Math.abs((c.x - point.x) * (a.y - point.y) - (a.x - point.x) * (c.y - point.y));

  return Math.abs(area - (areaA + areaB + areaC)) <= 1;
}

function isPointInShape(shape: Shape, point: { x: number; y: number }) {
  if (shape.type === "triangle") {
    const visualTriangle = getTrianglePoints(shape).map((trianglePoint) => (
      getVisualTrianglePoint(shape, trianglePoint)
    )) as TrianglePoints;

    return isPointInTriangle(point, visualTriangle);
  }

  const bounds = getVisualShapeBounds(shape);

  return (
    point.x >= bounds.left &&
    point.x <= bounds.right &&
    point.y >= bounds.top &&
    point.y <= bounds.bottom
  );
}

function getVisualShapeBounds(shape: Shape) {
  const depthScale = getShapeDepthScale(shape);
  const visualWidth = shape.width * depthScale;
  const visualHeight = shape.height * depthScale;

  return {
    left: shape.left + (shape.width - visualWidth) / 2,
    top: shape.top + (shape.height - visualHeight) / 2,
    width: visualWidth,
    height: visualHeight,
    right: shape.left + (shape.width + visualWidth) / 2,
    bottom: shape.top + (shape.height + visualHeight) / 2,
  };
}

function getResizeHandlesForShape(shape: Shape): ResizeHandlePoint[] {
  const bounds = getVisualShapeBounds(shape);
  const centerY = bounds.top + bounds.height / 2;

  if (shape.type === "circle") {
    return [{ handle: "right" as const, x: bounds.right, y: centerY }];
  }

  if (shape.type === "triangle") {
    const [top, bottomLeft, bottomRight] = getTrianglePoints(shape);
    const visualTop = getVisualTrianglePoint(shape, top);
    const visualBottomLeft = getVisualTrianglePoint(shape, bottomLeft);
    const visualBottomRight = getVisualTrianglePoint(shape, bottomRight);

    return [
      { handle: "top" as const, x: visualTop.x, y: visualTop.y, localX: top.x, localY: top.y },
      { handle: "bottom-left" as const, x: visualBottomLeft.x, y: visualBottomLeft.y, localX: bottomLeft.x, localY: bottomLeft.y },
      { handle: "bottom-right" as const, x: visualBottomRight.x, y: visualBottomRight.y, localX: bottomRight.x, localY: bottomRight.y },
    ];
  }

  return [
    { handle: "top-left" as const, x: bounds.left, y: bounds.top },
    { handle: "top-right" as const, x: bounds.right, y: bounds.top },
    { handle: "bottom-left" as const, x: bounds.left, y: bounds.bottom },
    { handle: "bottom-right" as const, x: bounds.right, y: bounds.bottom },
  ];
}

interface HandResults {
  multiHandLandmarks?: HandLandmark[][];
}

interface MediaPipeHands {
  setOptions(options: {
    maxNumHands: number;
    modelComplexity: number;
    minDetectionConfidence: number;
    minTrackingConfidence: number;
  }): void;
  onResults(callback: (results: HandResults) => void): void;
  send(input: { image: HTMLVideoElement }): Promise<void>;
  close(): void;
}

type HandsConstructor = new (options: {
  locateFile: (file: string) => string;
}) => MediaPipeHands;
 
declare global {
  interface Window {
    Hands: HandsConstructor;
  }
}

export default function HandTracking({ onReplayTutorial, onTutorialGesture }: HandTrackingProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(0);
  const handsRef = useRef<MediaPipeHands | null>(null);
  const shapesRef = useRef<Shape[]>([]);
  const toolbarButtonRefs = useRef<Record<ToolbarAction, HTMLButtonElement | null>>({
    rectangle: null,
    circle: null,
    triangle: null,
  });
  const nextShapeIdRef = useRef(1);
  const activeGesturesRef = useRef<Array<ActiveGesture | null>>([null, null]);
  const zoomGestureRef = useRef<{
    shapeId: number;
    startCenter: { x: number; y: number };
    startDistance: number;
    startShape: Shape;
  } | null>(null);
  const toolbarPinchStartedRef = useRef(false);
  const duplicatePinchStartedRef = useRef(false);
  const deletePinchStartedRef = useRef(false);
  const isDeleteModeRef = useRef(false);
  const gestureStartPointsRef = useRef<Array<PinchPoint | null>>([null, null]);
  const gestureStartShapesRef = useRef<Array<Shape | null>>([null, null]);
  const zGestureStartPointsRef = useRef<Array<PinchPoint | null>>([null, null]);
  const zGestureStartShapesRef = useRef<Array<Shape | null>>([null, null]);
  const moveOffsetsRef = useRef<Array<{ x: number; y: number } | null>>([null, null]);
  const smoothedPinchPointsRef = useRef<Array<PinchPoint | null>>([null, null]);
  const smoothedMiddlePinchPointsRef = useRef<Array<PinchPoint | null>>([null, null]);
  const pinchLocksRef = useRef<Record<PinchFinger, boolean[]>>({
    index: [false, false],
    middle: [false, false],
    ring: [false, false],
    pinky: [false, false],
  });
  const activeShapeIdsRef = useRef<number[]>([]);
  const hoveredShapeIdsRef = useRef<number[]>([]);
  const onTutorialGestureRef = useRef(onTutorialGesture);
  const fistStartTimeRef = useRef<number | null>(null);
  const fistClearedRef = useRef(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [activeShapeIds, setActiveShapeIds] = useState<number[]>([]);
  const [hoveredShapeIds, setHoveredShapeIds] = useState<number[]>([]);
  const [isPinching, setIsPinching] = useState(false);
  const [fistCountdown, setFistCountdown] = useState<number | null>(null);
  const [hoveredToolbarAction, setHoveredToolbarAction] = useState<ToolbarAction | null>(null);
  const [isDeleteMode, setIsDeleteMode] = useState(false);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [hasLoadedSavedShapes, setHasLoadedSavedShapes] = useState(false);

  useEffect(() => {
    onTutorialGestureRef.current = onTutorialGesture;
  }, [onTutorialGesture]);

  function reportTutorialGesture(gesture: TutorialGesture) {
    onTutorialGestureRef.current?.(gesture);
  }


// Defines the shapes
  useEffect(() => {
    shapesRef.current = shapes;
  }, [shapes]);

// Load saved shapes from cookies on initial mount, and save shapes to cookies whenever they change after the initial load
  useEffect(() => {
    queueMicrotask(() => {
      const savedShapes = readShapesCookie();

      if (savedShapes.length > 0) {
        setShapes(savedShapes);
        shapesRef.current = savedShapes;
        nextShapeIdRef.current = Math.max(...savedShapes.map((shape) => shape.id)) + 1;
      }

      setHasLoadedSavedShapes(true);
    });
  }, []);

// Save shapes to cookies whenever they change
  useEffect(() => {
    if (!hasLoadedSavedShapes) return;

    writeShapesCookie(shapes);
  }, [hasLoadedSavedShapes, shapes]);

// Set the Delete Mode
  useEffect(() => {
    isDeleteModeRef.current = isDeleteMode;
  }, [isDeleteMode]);

// Adds shapes
  function addShape(type: ShapeType) {
    const size = type === "circle" ? 150 : 180;
    const offset = (nextShapeIdRef.current % 5) * 26;
    const left = Math.min(
      window.innerWidth - SCREEN_MARGIN - size,
      Math.max(SCREEN_MARGIN, window.innerWidth / 2 - size / 2 + offset)
    );
    const top = Math.min(
      window.innerHeight - SCREEN_MARGIN - size,
      Math.max(SCREEN_MARGIN, window.innerHeight * 0.42 - size / 2 + offset)
    );

    setShapes((currentShapes) => [
      ...currentShapes,
      {
        id: nextShapeIdRef.current++,
        type,
        left,
        top,
        width: size,
        height: size,
        z: 0,
        ...(type === "triangle" ? { trianglePoints: getDefaultTrianglePoints(size, size) } : {}),
      },
    ]);
  }

// Load the MediaPipe Hands script and initialize the hand tracking functionality
  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js";
    script.onload = () => setIsLoaded(true);
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

// Basically shows all the stuff
  useEffect(() => {
    if (!isLoaded || !videoRef.current || !canvasRef.current || typeof window === "undefined") return;
    if (!window.Hands) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");

    if (!ctx) return;

    function syncCanvasSize() {
      const { width, height } = canvas.getBoundingClientRect();
      const pixelRatio = window.devicePixelRatio || 1;
      const nextWidth = Math.max(1, Math.round(width * pixelRatio));
      const nextHeight = Math.max(1, Math.round(height * pixelRatio));

      if (canvas.width !== nextWidth || canvas.height !== nextHeight) {
        canvas.width = nextWidth;
        canvas.height = nextHeight;
      }

      return { width, height, pixelRatio };
    }

    function getCanvasPoint(landmark: HandLandmark, width: number, height: number) {
      const overscan = Math.max(width, height) * HAND_TRACKING_OVERSCAN;
      const virtualWidth = width + overscan * 2;
      const virtualHeight = height + overscan * 2;

      return {
        x: (1 - landmark.x) * virtualWidth - overscan,
        y: landmark.y * virtualHeight - overscan,
      };
    }

    function isFist(landmarks: HandLandmark[]) {
      const curledFingers = [
        landmarks[INDEX_TIP].y > landmarks[INDEX_MCP].y,
        landmarks[MIDDLE_TIP].y > landmarks[MIDDLE_MCP].y,
        landmarks[RING_TIP].y > landmarks[RING_MCP].y,
        landmarks[PINKY_TIP].y > landmarks[PINKY_MCP].y,
      ].filter(Boolean).length;

      return curledFingers >= 4;
    }

    function getShapesByHitPriority() {
      return [...shapesRef.current].sort((firstShape, secondShape) => (
        secondShape.z - firstShape.z || secondShape.id - firstShape.id
      ));
    }

    function getResizeTargetAtPoint(point: { x: number; y: number }) {
      for (const shape of getShapesByHitPriority()) {
        const handle = getResizeHandlesForShape(shape).find(({ x, y }) => (
          Math.abs(point.x - x) <= CORNER_HIT_SIZE / 2 &&
          Math.abs(point.y - y) <= CORNER_HIT_SIZE / 2
        ))?.handle;

        if (handle) return { shape, handle };
      }

      return null;
    }

    function getShapeAtPoint(point: { x: number; y: number }) {
      return getShapesByHitPriority().find((shape) => isPointInShape(shape, point)) ?? null;
    }

    function getToolbarActionAtPoint(point: { x: number; y: number }) {
      const toolbarActions: ToolbarAction[] = ["rectangle", "circle", "triangle"];

      return toolbarActions.find((toolbarAction) => {
        const button = toolbarButtonRefs.current[toolbarAction];
        if (!button) return false;

        const rect = button.getBoundingClientRect();
        return (
          point.x >= rect.left &&
          point.x <= rect.right &&
          point.y >= rect.top &&
          point.y <= rect.bottom
        );
      }) ?? null;
    }

    function smoothPoint(
      point: PinchPoint,
      handIndex: number,
      storeRef: React.MutableRefObject<Array<PinchPoint | null>>
    ) {
      const previousPoint = storeRef.current[handIndex];
      if (!previousPoint) {
        storeRef.current[handIndex] = point;
        return point;
      }

      const nextPoint = {
        x: previousPoint.x + (point.x - previousPoint.x) * GESTURE_SMOOTHING,
        y: previousPoint.y + (point.y - previousPoint.y) * GESTURE_SMOOTHING,
        z: previousPoint.z + (point.z - previousPoint.z) * GESTURE_SMOOTHING,
      };
      storeRef.current[handIndex] = nextPoint;

      return nextPoint;
    }

    function getShapeZ(point: PinchPoint, startPoint: PinchPoint | null, startShape: Shape) {
      if (!startPoint) return startShape.z;

      const depthDelta = point.z - startPoint.z;
      const nextZ = Math.min(
        MAX_SHAPE_Z,
        Math.max(MIN_SHAPE_Z, startShape.z + depthDelta * Z_DEPTH_SENSITIVITY)
      );

      return nextZ;
    }

    function startGesture(point: PinchPoint, handIndex: number, gesture: ActiveGesture, shape: Shape) {
      activeGesturesRef.current[handIndex] = gesture;
      gestureStartPointsRef.current[handIndex] = point;
      gestureStartShapesRef.current[handIndex] = shape;

      if (gesture.type === "move") {
        moveOffsetsRef.current[handIndex] = {
          x: point.x - shape.left,
          y: point.y - shape.top,
        };
      }
    }

    function moveShapeFromPoint(point: PinchPoint, handIndex: number, shapeId: number) {
      const startShape = gestureStartShapesRef.current[handIndex];
      const startPoint = gestureStartPointsRef.current[handIndex];
      const moveOffset = moveOffsetsRef.current[handIndex];
      if (!startShape || !startPoint || !moveOffset) return;

      if (Math.hypot(point.x - startPoint.x, point.y - startPoint.y) >= 72) {
        reportTutorialGesture("drag");
      }

      setShapes((currentShapes) => currentShapes.map((shape) => {
        if (shape.id !== shapeId) return shape;

        return {
          ...shape,
          left: Math.min(
            window.innerWidth - SCREEN_MARGIN - startShape.width,
            Math.max(SCREEN_MARGIN, point.x - moveOffset.x)
          ),
          top: Math.min(
            window.innerHeight - SCREEN_MARGIN - startShape.height,
            Math.max(SCREEN_MARGIN, point.y - moveOffset.y)
          ),
        };
      }));
    }

    function deleteShape(shapeId: number) {
      reportTutorialGesture("delete");
      setShapes((currentShapes) => currentShapes.filter((shape) => shape.id !== shapeId));
      activeGesturesRef.current = activeGesturesRef.current.map((gesture) => (
        gesture?.shapeId === shapeId ? null : gesture
      ));
      gestureStartShapesRef.current = gestureStartShapesRef.current.map((shape) => (
        shape?.id === shapeId ? null : shape
      ));
      zGestureStartShapesRef.current = zGestureStartShapesRef.current.map((shape) => (
        shape?.id === shapeId ? null : shape
      ));
      if (zoomGestureRef.current?.shapeId === shapeId) {
        zoomGestureRef.current = null;
      }
      if (activeShapeIdsRef.current.includes(shapeId)) {
        const nextActiveShapeIds = activeShapeIdsRef.current.filter((activeShapeId) => activeShapeId !== shapeId);
        activeShapeIdsRef.current = nextActiveShapeIds;
        setActiveShapeIds(nextActiveShapeIds);
      }
    }

    function duplicateShape(shapeId: number) {
      const shapeToDuplicate = shapesRef.current.find((shape) => shape.id === shapeId);
      if (!shapeToDuplicate) return;

      const offset = 28;
      const nextWidth = shapeToDuplicate.width;
      const nextHeight = shapeToDuplicate.height;
      const duplicateShape = {
        ...shapeToDuplicate,
        id: nextShapeIdRef.current++,
        left: Math.min(
          window.innerWidth - SCREEN_MARGIN - nextWidth,
          Math.max(SCREEN_MARGIN, shapeToDuplicate.left + offset)
        ),
        top: Math.min(
          window.innerHeight - SCREEN_MARGIN - nextHeight,
          Math.max(SCREEN_MARGIN, shapeToDuplicate.top + offset)
        ),
        trianglePoints: shapeToDuplicate.trianglePoints
          ? (shapeToDuplicate.trianglePoints.map((point) => ({ ...point })) as TrianglePoints)
          : undefined,
      };

      reportTutorialGesture("duplicate");
      setShapes((currentShapes) => [...currentShapes, duplicateShape]);
    }

    function clearAllShapes() {
      setShapes([]);
      activeGesturesRef.current = [null, null];
      gestureStartShapesRef.current = [null, null];
      gestureStartPointsRef.current = [null, null];
      zGestureStartShapesRef.current = [null, null];
      zGestureStartPointsRef.current = [null, null];
      moveOffsetsRef.current = [null, null];
      smoothedPinchPointsRef.current = [null, null];
      smoothedMiddlePinchPointsRef.current = [null, null];
      zoomGestureRef.current = null;
      activeShapeIdsRef.current = [];
      hoveredShapeIdsRef.current = [];
      setActiveShapeIds([]);
      setHoveredShapeIds([]);
    }

    function updateShapeZFromPoint(point: PinchPoint, handIndex: number, shapeId: number) {
      const startShape = zGestureStartShapesRef.current[handIndex];
      const startPoint = zGestureStartPointsRef.current[handIndex];
      if (!startShape || !startPoint) return;
      const nextZ = getShapeZ(point, startPoint, startShape);

      if (Math.abs(nextZ - startShape.z) >= 10) {
        reportTutorialGesture("depth");
      }

      setShapes((currentShapes) => currentShapes.map((shape) => {
        if (shape.id !== shapeId) return shape;

        return {
          ...shape,
          z: nextZ,
        };
      }));
    }

    function startZGesture(point: PinchPoint, handIndex: number, shape: Shape) {
      zGestureStartPointsRef.current[handIndex] = point;
      zGestureStartShapesRef.current[handIndex] = shape;
    }

    function resizeShapeFromPoint(point: PinchPoint, handIndex: number, handle: ResizeHandle, shapeId: number) {
      const startShape = gestureStartShapesRef.current[handIndex];
      const startPoint = gestureStartPointsRef.current[handIndex];
      if (!startShape || !startPoint) return;

      const dx = point.x - startPoint.x;
      const dy = point.y - startPoint.y;
      const stableDx = Math.abs(dx) < GESTURE_DEADZONE ? 0 : dx;
      const stableDy = Math.abs(dy) < GESTURE_DEADZONE ? 0 : dy;
      const right = startShape.left + startShape.width;
      const bottom = startShape.top + startShape.height;
      let nextLeft = startShape.left;
      let nextTop = startShape.top;
      let nextWidth = startShape.width;
      let nextHeight = startShape.height;

      if (startShape.type === "triangle") {
        if (Math.hypot(dx, dy) >= 46) {
          reportTutorialGesture("resize");
        }

        const pointIndex = handle === "top"
          ? 0
          : handle === "bottom-left"
            ? 1
            : handle === "bottom-right"
              ? 2
              : null;
        if (pointIndex === null) return;

        setShapes((currentShapes) => currentShapes.map((shape) => (
          shape.id === shapeId
            ? normalizeTriangleShape(
              shape,
              getTrianglePoints(shape).map((trianglePoint, trianglePointIndex) => (
                trianglePointIndex === pointIndex
                  ? {
                    x: shape.width / 2 + (point.x - (shape.left + shape.width / 2)) / getShapeDepthScale(shape),
                    y: shape.height / 2 + (point.y - (shape.top + shape.height / 2)) / getShapeDepthScale(shape),
                  }
                  : { ...trianglePoint }
              )) as TrianglePoints,
              pointIndex,
              point
            )
            : shape
        )));
        return;
      } else if (startShape.type === "circle") {
        const centerX = startShape.left + startShape.width / 2;
        const centerY = startShape.top + startShape.height / 2;
        const startRadius = startShape.width / 2;
        const requestedRadius = startRadius + stableDx;
        const maxRadius = Math.max(
          MIN_SHAPE_SIZE / 2,
          Math.min(
            centerX - SCREEN_MARGIN,
            window.innerWidth - SCREEN_MARGIN - centerX,
            centerY - SCREEN_MARGIN,
            window.innerHeight - SCREEN_MARGIN - centerY
          )
        );
        const radius = Math.min(maxRadius, Math.max(MIN_SHAPE_SIZE / 2, requestedRadius));
        const diameter = radius * 2;

        nextLeft = centerX - radius;
        nextTop = centerY - radius;
        nextWidth = diameter;
        nextHeight = diameter;
      } else if (handle === "top") {
        nextHeight = Math.min(bottom - SCREEN_MARGIN, Math.max(MIN_SHAPE_SIZE, startShape.height - stableDy));
        nextTop = bottom - nextHeight;
      } else {
        if (handle.includes("left")) {
        nextWidth = Math.min(right - SCREEN_MARGIN, Math.max(MIN_SHAPE_SIZE, startShape.width - stableDx));
        nextLeft = right - nextWidth;
        } else {
        nextWidth = Math.min(
          window.innerWidth - SCREEN_MARGIN - startShape.left,
          Math.max(MIN_SHAPE_SIZE, startShape.width + stableDx)
        );
        }

        if (handle.includes("top")) {
        nextHeight = Math.min(bottom - SCREEN_MARGIN, Math.max(MIN_SHAPE_SIZE, startShape.height - stableDy));
        nextTop = bottom - nextHeight;
        } else {
        nextHeight = Math.min(
          window.innerHeight - SCREEN_MARGIN - startShape.top,
          Math.max(MIN_SHAPE_SIZE, startShape.height + stableDy)
        );
        }
      }

      if (Math.hypot(dx, dy) >= 46) {
        reportTutorialGesture("resize");
      }

      setShapes((currentShapes) => currentShapes.map((shape) => {
        if (shape.id !== shapeId) return shape;

        return {
          ...shape,
          left: nextLeft,
          top: nextTop,
          width: nextWidth,
          height: nextHeight,
        };
      }));
    }

    function getDistance(pointA: { x: number; y: number }, pointB: { x: number; y: number }) {
      return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
    }

    function getCenter(pointA: { x: number; y: number }, pointB: { x: number; y: number }) {
      return {
        x: (pointA.x + pointB.x) / 2,
        y: (pointA.y + pointB.y) / 2,
      };
    }

    function getHandThresholdScale(landmarks: HandLandmark[], width: number, height: number) {
      const wrist = getCanvasPoint(landmarks[0], width, height);
      const middleKnuckle = getCanvasPoint(landmarks[MIDDLE_MCP], width, height);
      const handSize = getDistance(wrist, middleKnuckle);

      return Math.min(
        MAX_PINCH_SCALE,
        Math.max(MIN_PINCH_SCALE, handSize / HAND_SCALE_REFERENCE_SIZE)
      );
    }

    function startZoomGesture(shape: Shape, pointA: PinchPoint, pointB: PinchPoint) {
      const startDistance = Math.max(1, getDistance(pointA, pointB));
      const startCenter = getCenter(pointA, pointB);

      zoomGestureRef.current = {
        shapeId: shape.id,
        startCenter,
        startDistance,
        startShape: shape,
      };
      activeGesturesRef.current = [null, null];
      gestureStartShapesRef.current = [null, null];
      gestureStartPointsRef.current = [null, null];
      moveOffsetsRef.current = [null, null];
    }

    function updateZoomGesture(pointA: PinchPoint, pointB: PinchPoint) {
      const zoomGesture = zoomGestureRef.current;
      if (!zoomGesture) return;

      const distance = Math.max(1, getDistance(pointA, pointB));
      const scale = Math.max(0.3, distance / zoomGesture.startDistance);
      const center = getCenter(pointA, pointB);
      const nextWidth = Math.max(MIN_SHAPE_SIZE, zoomGesture.startShape.width * scale);
      const nextHeight = Math.max(MIN_SHAPE_SIZE, zoomGesture.startShape.height * scale);
      const pointScaleX = nextWidth / zoomGesture.startShape.width;
      const pointScaleY = nextHeight / zoomGesture.startShape.height;
      const centerOffsetX = zoomGesture.startCenter.x - zoomGesture.startShape.left;
      const centerOffsetY = zoomGesture.startCenter.y - zoomGesture.startShape.top;

      if (Math.abs(scale - 1) >= 0.22) {
        reportTutorialGesture("zoom");
      }

      setShapes((currentShapes) => currentShapes.map((shape) => {
        if (shape.id !== zoomGesture.shapeId) return shape;

        return {
          ...shape,
          left: Math.min(
            window.innerWidth - SCREEN_MARGIN - nextWidth,
            Math.max(SCREEN_MARGIN, center.x - centerOffsetX * scale)
          ),
          top: Math.min(
            window.innerHeight - SCREEN_MARGIN - nextHeight,
            Math.max(SCREEN_MARGIN, center.y - centerOffsetY * scale)
          ),
          width: nextWidth,
          height: nextHeight,
          ...(zoomGesture.startShape.type === "triangle" ? {
            trianglePoints: getTrianglePoints(zoomGesture.startShape).map((trianglePoint) => ({
              x: trianglePoint.x * pointScaleX,
              y: trianglePoint.y * pointScaleY,
            })) as TrianglePoints,
          } : {}),
        };
      }));
    }

    function getPinchState(
      landmarks: HandLandmark[],
      fingerTipIndex: number,
      threshold: number,
      wasPinching: boolean,
      width: number,
      height: number
    ) {
      const thumbTip = getCanvasPoint(landmarks[THUMB_TIP], width, height);
      const fingerTip = getCanvasPoint(landmarks[fingerTipIndex], width, height);
      const pinchPoint = {
        x: (thumbTip.x + fingerTip.x) / 2,
        y: (thumbTip.y + fingerTip.y) / 2,
        z: (landmarks[THUMB_TIP].z + landmarks[fingerTipIndex].z) / 2,
      };
      const pinchDistance = Math.hypot(thumbTip.x - fingerTip.x, thumbTip.y - fingerTip.y);
      const thresholdScale = getHandThresholdScale(landmarks, width, height);
      const scaledThreshold = threshold * thresholdScale;
      const activeThreshold = wasPinching
        ? scaledThreshold + PINCH_RELEASE_PADDING * thresholdScale
        : scaledThreshold;

      return {
        isPinching: pinchDistance < activeThreshold,
        pinchPoint,
        pinchDistance,
      };
    }

    const hands = new window.Hands({
      locateFile: (file: string) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`;
      },
    });

    handsRef.current = hands;

    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults((results) => {
      const { width, height, pixelRatio } = syncCanvasSize();

      ctx.save();
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const indexPinchPoints: Array<PinchPoint | null> = [null, null];
      const middlePinchPoints: Array<PinchPoint | null> = [null, null];
      const ringPinchPoints: Array<PinchPoint | null> = [null, null];
      const pinkyPinchPoints: Array<PinchPoint | null> = [null, null];
      const indexHoverPoints: Array<{ x: number; y: number } | null> = [null, null];
      let detectedHandCount = 0;
      let fistCount = 0;

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        for (let handIndex = 0; handIndex < results.multiHandLandmarks.length; handIndex++) {
          const landmarks = results.multiHandLandmarks[handIndex];
          detectedHandCount++;
          if (isFist(landmarks)) {
            fistCount++;
          }
          ctx.strokeStyle = "#00FF00";
          ctx.lineWidth = 2;

          for (const [start, end] of HAND_CONNECTIONS) {
            const startPoint = getCanvasPoint(landmarks[start], width, height);
            const endPoint = getCanvasPoint(landmarks[end], width, height);

            ctx.beginPath();
            ctx.moveTo(startPoint.x, startPoint.y);
            ctx.lineTo(endPoint.x, endPoint.y);
            ctx.stroke();
          }

          ctx.fillStyle = "#FF0000";

          for (const landmark of landmarks) {
            const canvasPoint = getCanvasPoint(landmark, width, height);

            ctx.beginPath();
            ctx.arc(canvasPoint.x, canvasPoint.y, 3, 0, 2 * Math.PI);
            ctx.fill();
          }

          if (handIndex < indexPinchPoints.length) {
            indexHoverPoints[handIndex] = getCanvasPoint(landmarks[INDEX_TIP], width, height);

            const indexPinch = getPinchState(
              landmarks,
              INDEX_TIP,
              INDEX_PINCH_THRESHOLD,
              pinchLocksRef.current.index[handIndex],
              width,
              height
            );
            const middlePinch = getPinchState(
              landmarks,
              MIDDLE_TIP,
              MIDDLE_PINCH_THRESHOLD,
              pinchLocksRef.current.middle[handIndex],
              width,
              height
            );
            const ringPinch = getPinchState(
              landmarks,
              RING_TIP,
              RING_PINCH_THRESHOLD,
              pinchLocksRef.current.ring[handIndex],
              width,
              height
            );
            const pinkyPinch = getPinchState(
              landmarks,
              PINKY_TIP,
              PINKY_PINCH_THRESHOLD,
              pinchLocksRef.current.pinky[handIndex],
              width,
              height
            );

            pinchLocksRef.current.index[handIndex] = indexPinch.isPinching;
            pinchLocksRef.current.middle[handIndex] = middlePinch.isPinching;
            pinchLocksRef.current.ring[handIndex] = ringPinch.isPinching;
            pinchLocksRef.current.pinky[handIndex] = pinkyPinch.isPinching;

            const activePinches = [
              { finger: "index" as const, state: indexPinch },
              { finger: "middle" as const, state: middlePinch },
              { finger: "ring" as const, state: ringPinch },
              { finger: "pinky" as const, state: pinkyPinch },
            ]
              .filter(({ state }) => state.isPinching)
              .sort((firstPinch, secondPinch) => firstPinch.state.pinchDistance - secondPinch.state.pinchDistance);
            const closestPinch = activePinches[0];

            if (closestPinch?.finger === "pinky") {
              pinkyPinchPoints[handIndex] = closestPinch.state.pinchPoint;
            } else if (closestPinch?.finger === "ring") {
              ringPinchPoints[handIndex] = closestPinch.state.pinchPoint;
            } else if (closestPinch?.finger === "middle") {
              middlePinchPoints[handIndex] = closestPinch.state.pinchPoint;
            } else if (closestPinch?.finger === "index") {
              indexPinchPoints[handIndex] = closestPinch.state.pinchPoint;
            }
          }
        }
      }

      for (let handIndex = detectedHandCount; handIndex < indexPinchPoints.length; handIndex++) {
        pinchLocksRef.current.index[handIndex] = false;
        pinchLocksRef.current.middle[handIndex] = false;
        pinchLocksRef.current.ring[handIndex] = false;
        pinchLocksRef.current.pinky[handIndex] = false;
      }

      const hasBothFists = detectedHandCount >= 2 && fistCount >= 2;

      if (hasBothFists) {
        const now = performance.now();
        const fistStartTime = fistStartTimeRef.current ?? now;
        const elapsed = now - fistStartTime;
        const remainingMs = Math.max(0, FIST_CLEAR_DURATION_MS - elapsed);

        fistStartTimeRef.current = fistStartTime;
        setFistCountdown(Math.ceil(remainingMs / 1000));

        if (elapsed >= FIST_CLEAR_DURATION_MS && !fistClearedRef.current) {
          fistClearedRef.current = true;
          reportTutorialGesture("clear");
          clearAllShapes();
        }
      } else {
        fistStartTimeRef.current = null;
        fistClearedRef.current = false;
        setFistCountdown(null);
      }

      const hasAnyIndexPinch = indexPinchPoints.some(Boolean);
      const hasAnyMiddlePinch = middlePinchPoints.some(Boolean);
      const hasAnyRingPinch = ringPinchPoints.some(Boolean);
      const hasAnyPinkyPinch = pinkyPinchPoints.some(Boolean);
      const hasAnyPinch = hasAnyIndexPinch || hasAnyMiddlePinch || hasAnyRingPinch || hasAnyPinkyPinch;
      const nextHoveredShapeIds = Array.from(new Set(indexHoverPoints
        .map((point) => (point ? getShapeAtPoint(point)?.id ?? null : null))
        .filter((shapeId): shapeId is number => shapeId !== null)))
        .sort((firstId, secondId) => firstId - secondId);

      if (!areNumberArraysEqual(hoveredShapeIdsRef.current, nextHoveredShapeIds)) {
        hoveredShapeIdsRef.current = nextHoveredShapeIds;
        setHoveredShapeIds(nextHoveredShapeIds);
      }

      if (!hasAnyPinch) {
        activeGesturesRef.current = [null, null];
        gestureStartShapesRef.current = [null, null];
        gestureStartPointsRef.current = [null, null];
        zGestureStartShapesRef.current = [null, null];
        zGestureStartPointsRef.current = [null, null];
        moveOffsetsRef.current = [null, null];
        smoothedPinchPointsRef.current = [null, null];
        smoothedMiddlePinchPointsRef.current = [null, null];
        zoomGestureRef.current = null;
        toolbarPinchStartedRef.current = false;
        duplicatePinchStartedRef.current = false;
        deletePinchStartedRef.current = false;
        setHoveredToolbarAction(null);
      }

      setIsPinching(hasAnyPinch);

      const smoothedPinchPoints = indexPinchPoints.map((point, handIndex) => (
        point ? smoothPoint(point, handIndex, smoothedPinchPointsRef) : null
      ));
      const smoothedMiddlePinchPoints = middlePinchPoints.map((point, handIndex) => (
        point ? smoothPoint(point, handIndex, smoothedMiddlePinchPointsRef) : null
      ));
      const primaryPinchPoint = smoothedPinchPoints.find(Boolean) ?? null;
      const primaryRingPoint = ringPinchPoints.find(Boolean) ?? null;
      const primaryPinkyPoint = pinkyPinchPoints.find(Boolean) ?? null;
      const hasLockedShapeGesture = activeGesturesRef.current.some(Boolean) || Boolean(zoomGestureRef.current);
      const toolbarAction = primaryPinchPoint && !hasLockedShapeGesture
        ? getToolbarActionAtPoint(primaryPinchPoint)
        : null;

      setHoveredToolbarAction(toolbarAction);

      if (toolbarAction) {
        if (!toolbarPinchStartedRef.current) {
          toolbarPinchStartedRef.current = true;
          addShape(toolbarAction);
        }
      }

      if (primaryRingPoint && !duplicatePinchStartedRef.current) {
        const shape = getShapeAtPoint(primaryRingPoint);

        if (shape) {
          duplicatePinchStartedRef.current = true;
          duplicateShape(shape.id);
        }
      }

      if (primaryPinkyPoint && !deletePinchStartedRef.current) {
        const shape = getShapeAtPoint(primaryPinkyPoint);

        if (shape) {
          deletePinchStartedRef.current = true;
          deleteShape(shape.id);
        }
      }

      if (primaryPinchPoint && !toolbarAction && isDeleteModeRef.current && !deletePinchStartedRef.current) {
        const shape = getShapeAtPoint(primaryPinchPoint);

        if (shape) {
          deletePinchStartedRef.current = true;
          deleteShape(shape.id);
        }
      }

      smoothedMiddlePinchPoints.forEach((smoothedMiddlePinchPoint, handIndex) => {
        if (!smoothedMiddlePinchPoint) {
          zGestureStartShapesRef.current[handIndex] = null;
          zGestureStartPointsRef.current[handIndex] = null;
          smoothedMiddlePinchPointsRef.current[handIndex] = null;
          return;
        }

        const activeZShape = zGestureStartShapesRef.current[handIndex];
        if (activeZShape) {
          updateShapeZFromPoint(smoothedMiddlePinchPoint, handIndex, activeZShape.id);
          return;
        }

        const shape = getShapeAtPoint(smoothedMiddlePinchPoint);
        if (shape) {
          startZGesture(smoothedMiddlePinchPoint, handIndex, shape);
          updateShapeZFromPoint(smoothedMiddlePinchPoint, handIndex, shape.id);
        }
      });

      if (!toolbarAction && !isDeleteModeRef.current) {
        const twoHandPoints = smoothedPinchPoints.filter((point): point is PinchPoint => Boolean(point));
        let isZoomingThisFrame = false;

        if (twoHandPoints.length === 2) {
          const firstShape = getShapeAtPoint(twoHandPoints[0]);
          const secondShape = getShapeAtPoint(twoHandPoints[1]);

          if (firstShape && secondShape && firstShape.id === secondShape.id) {
            isZoomingThisFrame = true;
            if (!zoomGestureRef.current || zoomGestureRef.current.shapeId !== firstShape.id) {
              startZoomGesture(firstShape, twoHandPoints[0], twoHandPoints[1]);
            }
            updateZoomGesture(twoHandPoints[0], twoHandPoints[1]);
          }
        }

        if (!isZoomingThisFrame && zoomGestureRef.current) {
          zoomGestureRef.current = null;
          activeGesturesRef.current = [null, null];
          gestureStartShapesRef.current = [null, null];
          gestureStartPointsRef.current = [null, null];
          moveOffsetsRef.current = [null, null];
        }

        if (!zoomGestureRef.current) {
          smoothedPinchPoints.forEach((smoothedPinchPoint, handIndex) => {
            if (!smoothedPinchPoint || activeGesturesRef.current[handIndex]) return;

            const resizeTarget = getResizeTargetAtPoint(smoothedPinchPoint);

            if (resizeTarget) {
              startGesture(
                smoothedPinchPoint,
                handIndex,
                {
                  type: "resize",
                  handle: resizeTarget.handle,
                  shapeId: resizeTarget.shape.id,
                },
                resizeTarget.shape
              );
            } else {
              const shape = getShapeAtPoint(smoothedPinchPoint);

              if (shape) {
                startGesture(smoothedPinchPoint, handIndex, { type: "move", shapeId: shape.id }, shape);
              }
            }
          });

          smoothedPinchPoints.forEach((smoothedPinchPoint, handIndex) => {
            const gesture = activeGesturesRef.current[handIndex];
            if (!smoothedPinchPoint || !gesture) return;

            if (gesture.type === "move") {
              const resizeTarget = getResizeTargetAtPoint(smoothedPinchPoint);

              if (resizeTarget && resizeTarget.shape.id === gesture.shapeId) {
                startGesture(
                  smoothedPinchPoint,
                  handIndex,
                  {
                    type: "resize",
                    handle: resizeTarget.handle,
                    shapeId: resizeTarget.shape.id,
                  },
                  resizeTarget.shape
                );
              }
            }

            const currentGesture = activeGesturesRef.current[handIndex];
            if (!currentGesture) return;

            if (currentGesture.type === "resize") {
              resizeShapeFromPoint(
                smoothedPinchPoint,
                handIndex,
                currentGesture.handle,
                currentGesture.shapeId
              );
            } else if (currentGesture.type === "move") {
              moveShapeFromPoint(smoothedPinchPoint, handIndex, currentGesture.shapeId);
            }
          });
        }

        smoothedPinchPoints.forEach((smoothedPinchPoint, handIndex) => {
          if (smoothedPinchPoint) return;

          activeGesturesRef.current[handIndex] = null;
          gestureStartShapesRef.current[handIndex] = null;
          gestureStartPointsRef.current[handIndex] = null;
          moveOffsetsRef.current[handIndex] = null;
          smoothedPinchPointsRef.current[handIndex] = null;
        });

      }

      smoothedPinchPoints.forEach((smoothedPinchPoint, handIndex) => {
        if (smoothedPinchPoint) return;

        activeGesturesRef.current[handIndex] = null;
        gestureStartShapesRef.current[handIndex] = null;
        gestureStartPointsRef.current[handIndex] = null;
        moveOffsetsRef.current[handIndex] = null;
        smoothedPinchPointsRef.current[handIndex] = null;
      });

      if (!hasAnyPinkyPinch && !(primaryPinchPoint && isDeleteModeRef.current)) {
        deletePinchStartedRef.current = false;
      }

      if (!hasAnyRingPinch) {
        duplicatePinchStartedRef.current = false;
      }

      if (!hasAnyIndexPinch) {
        toolbarPinchStartedRef.current = false;
      }

      const nextActiveShapeIds = Array.from(new Set([
        ...activeGesturesRef.current
          .map((gesture) => gesture?.shapeId ?? null)
          .filter((shapeId): shapeId is number => shapeId !== null),
        ...zGestureStartShapesRef.current
          .map((shape) => shape?.id ?? null)
          .filter((shapeId): shapeId is number => shapeId !== null),
        ...(zoomGestureRef.current ? [zoomGestureRef.current.shapeId] : []),
      ])).sort((firstId, secondId) => firstId - secondId);

      if (!areNumberArraysEqual(activeShapeIdsRef.current, nextActiveShapeIds)) {
        activeShapeIdsRef.current = nextActiveShapeIds;
        setActiveShapeIds(nextActiveShapeIds);
      }

      ctx.restore();
    });

    async function initCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
        processFrame();
      } catch (err) {
        console.error("Error accessing camera:", err);
      }
    }

    async function processFrame() {
      if (video.readyState === 4) {
        await hands.send({ image: video });
      }
      animationRef.current = requestAnimationFrame(processFrame);
    }

    initCamera();

    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
      if (handsRef.current) {
        handsRef.current.close();
      }
    };
  }, [isLoaded]);

  return (
    <div className="hand-tracking-container">
      <video
        ref={videoRef}
        style={{ display: "none" }}
        autoPlay
        playsInline
      />
      <div className="shape-stage">
        {shapes.map((shape) => (
          (() => {
            const zProgress = (shape.z - MIN_SHAPE_Z) / (MAX_SHAPE_Z - MIN_SHAPE_Z);
            const depthScale = getShapeDepthScale(shape);
            const shadowYOffset = 4 + zProgress * 62;
            const shadowBlur = 12 + zProgress * 96;
            const shadowAlpha = 0.08 + zProgress * 0.5;
            const brightness = 0.72 + zProgress * 0.42;
            const groundShadowOpacity = 0.12 + zProgress * 0.68;
            const groundShadowScale = 0.75 + zProgress * 1.45;
            const groundShadowY = 14 + zProgress * 54;
            const trianglePath = shape.type === "triangle" ? getTrianglePath(shape) : "";
            const shapeStyle: ShapeStyle = {
              left: `${shape.left}px`,
              top: `${shape.top}px`,
              width: `${shape.width}px`,
              height: `${shape.height}px`,
              transform: `translateZ(${shape.z}px) scale(${depthScale})`,
              zIndex: Math.round(1000 + shape.z),
              "--shape-shadow-y": `${shadowYOffset}px`,
              "--shape-shadow-blur": `${shadowBlur}px`,
              "--shape-shadow-alpha": `${shadowAlpha}`,
              "--shape-brightness": `${brightness}`,
              "--shape-ground-shadow-opacity": `${groundShadowOpacity}`,
              "--shape-ground-shadow-scale": `${groundShadowScale}`,
              "--shape-ground-shadow-y": `${groundShadowY}px`,
            };

            return (
              <div
                key={shape.id}
                className={`shape-box shape-box-${shape.type} ${activeShapeIds.includes(shape.id) ? "shape-box-active" : ""} ${hoveredShapeIds.includes(shape.id) ? "shape-box-hand-hover" : ""} ${isDeleteMode ? "shape-box-delete-mode" : ""}`}
                style={shapeStyle}
              >
                {shape.type === "triangle" ? (
                  <svg
                    className="shape-fill shape-fill-triangle"
                    viewBox={`0 0 ${shape.width} ${shape.height}`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      className="shape-triangle-outline"
                      d={trianglePath}
                    />
                    <path
                      className="shape-triangle-main"
                      fill="rgba(20, 184, 166, 0.72)"
                      stroke="#111827"
                      strokeLinejoin="round"
                      strokeWidth="4"
                      d={trianglePath}
                    />
                  </svg>
                ) : (
                  <div className={`shape-fill shape-fill-${shape.type}`} />
                )}
                <span className="shape-z-label">
                  z {Math.round(shape.z)}
                </span>
                {getResizeHandlesForShape(shape).map(({ handle, localX, localY }) => (
                  <span
                    key={handle}
                    className={`resize-corner resize-corner-${handle} ${shape.type === "triangle" ? "resize-corner-free" : ""}`}
                    style={shape.type === "triangle" ? {
                      left: `${(localX ?? 0) - 17}px`,
                      top: `${(localY ?? 0) - 17}px`,
                    } : undefined}
                  />
                ))}
              </div>
            );
          })()
        ))}
      </div>
      <canvas
        ref={canvasRef}
        className="hand-tracking-canvas"
      />
      <div className="pinch-status">
        <div className={`pinch-indicator ${isPinching ? "pinch-indicator-active" : ""}`}>
          {isPinching ? "Pinch detected" : "Pinch not detected"}
        </div>
        <button
          className="pinch-help-button"
          type="button"
          aria-label="Open tutorial"
          onPointerDown={(event) => {
            event.stopPropagation();
            onReplayTutorial?.();
          }}
        >
          ?
        </button>
      </div>
      {fistCountdown !== null && (
        <div className="fist-countdown">
          {fistCountdown > 0 ? `Clearing in ${fistCountdown}` : "Cleared"}
        </div>
      )}
      <div className="shape-toolbar">
        <button
          ref={(button) => {
            toolbarButtonRefs.current.rectangle = button;
          }}
          className={hoveredToolbarAction === "rectangle" ? "shape-toolbar-button-active" : ""}
          type="button"
          onClick={() => addShape("rectangle")}
        >
          Rectangle
        </button>
        <button
          ref={(button) => {
            toolbarButtonRefs.current.circle = button;
          }}
          className={hoveredToolbarAction === "circle" ? "shape-toolbar-button-active" : ""}
          type="button"
          onClick={() => addShape("circle")}
        >
          Circle
        </button>
        <button
          ref={(button) => {
            toolbarButtonRefs.current.triangle = button;
          }}
          className={hoveredToolbarAction === "triangle" ? "shape-toolbar-button-active" : ""}
          type="button"
          onClick={() => addShape("triangle")}
        >
          Triangle
        </button>
      </div>
    </div>
  );
}
