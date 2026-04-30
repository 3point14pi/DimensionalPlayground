"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import styles from "./page.module.css";

interface HandLandmark {
  x: number;
  y: number;
  z: number;
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
type PhysicsShape = {
  id: number;
  type: "circle" | "square";
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rotation: number;
  angularVelocity: number;
};
type FingerPoint = { x: number; y: number; time: number };
type FingerVelocity = { vx: number; vy: number };

declare global {
  interface Window {
    Hands: HandsConstructor;
  }
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
const INDEX_TIP = 8;
const BUTTON_PINCH_HOLD_MS = 2000;
const BUTTON_PINCH_THRESHOLD = 50;
const FINGER_GRAB_RADIUS = 76;
// Raise this to make shapes stay grabbed longer; lower it to make flings release more easily.
const THROW_RELEASE_SPEED = 360;
const THROW_RELEASE_COOLDOWN_MS = 0;
const PHYSICS_GRAVITY = 0.62;
const PHYSICS_FRICTION = 0.994;
const PHYSICS_BOUNCE = 0.82;
const HAND_TRACKING_OVERSCAN = 0.05;
const PHYSICS_SHAPE_BLUEPRINTS = [
  { id: 1, type: "circle" as const, size: 100 },
  { id: 2, type: "square" as const, size: 64 },
  { id: 3, type: "circle" as const, size: 52 },
  { id: 4, type: "square" as const, size: 56 },
  { id: 5, type: "circle" as const, size: 64 },
  { id: 6, type: "square" as const, size: 50 },
  { id: 7, type: "circle" as const, size: 46 },
  { id: 8, type: "square" as const, size: 60 },
  { id: 9, type: "circle" as const, size: 68 },
  { id: 10, type: "square" as const, size: 48 },
  { id: 11, type: "circle" as const, size: 54 },
  { id: 12, type: "square" as const, size: 66 },
];

const handActions = [
  {
    title: "Pinch",
    text: "Grab, move, resize, and create shapes.",
  },
  {
    title: "Middle finger touch thumb",
    text: "Push shapes forward and backward in depth.",
  },
  {
    title: "Ring finger touch thumb",
    text: "Duplicate a shape with a quick copy gesture.",
  },
  {
    title: "Pinky touch thumb",
    text: "Delete a shape without switching tools.",
  },
];

const signingActions = [
  {
    title: "Sign Recognition",
    text: "Use your hands to show signs, motion, and simple gestures while the page writes detected words on screen.",
  },
];
type ActiveDescription = "playground" | "signing" | null;

export default function Home() {
  const router = useRouter();
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playgroundButtonRef = useRef<HTMLAnchorElement>(null);
  const signingButtonRef = useRef<HTMLAnchorElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(0);
  const physicsAnimationRef = useRef<number>(0);
  const handsRef = useRef<MediaPipeHands | null>(null);
  const physicsShapesRef = useRef<PhysicsShape[]>([]);
  const physicsShapeRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const activeDragShapeIdsRef = useRef<Array<number | null>>([null, null]);
  const indexFingerPointsRef = useRef<Array<FingerPoint | null>>([null, null]);
  const previousIndexFingerPointsRef = useRef<Array<FingerPoint | null>>([null, null]);
  const lastFingerVelocitiesRef = useRef<FingerVelocity[]>([
    { vx: 0, vy: 0 },
    { vx: 0, vy: 0 },
  ]);
  const lastDraggedShapeVelocitiesRef = useRef<Record<number, FingerVelocity>>({});
  const dragReleaseUntilRef = useRef<number[]>([0, 0]);
  const playgroundPinchStartRef = useRef<number | null>(null);
  const signingPinchStartRef = useRef<number | null>(null);
  const hasNavigatedToPlaygroundRef = useRef(false);
  const hasNavigatedToSigningRef = useRef(false);
  const mousePromptTimerRef = useRef<number | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isHandHoveringPlayground, setIsHandHoveringPlayground] = useState(false);
  const [isHandHoveringSigning, setIsHandHoveringSigning] = useState(false);
  const [playgroundPinchProgress, setPlaygroundPinchProgress] = useState(0);
  const [signingPinchProgress, setSigningPinchProgress] = useState(0);
  const [isIntroVisible, setIsIntroVisible] = useState(true);
  const [hasDetectedHands, setHasDetectedHands] = useState(false);
  const [mousePrompt, setMousePrompt] = useState<string | null>(null);
  const activeDescription: ActiveDescription = isHandHoveringPlayground
    ? "playground"
    : isHandHoveringSigning
      ? "signing"
      : null;
  const shouldShowActions = activeDescription === "playground";
  const shouldShowSigningActions = activeDescription === "signing";

  function showMousePrompt(destination: string) {
    setMousePrompt(`Pinch ${destination} with your hand to open it.`);

    if (mousePromptTimerRef.current !== null) {
      window.clearTimeout(mousePromptTimerRef.current);
    }

    mousePromptTimerRef.current = window.setTimeout(() => {
      setMousePrompt(null);
      mousePromptTimerRef.current = null;
    }, 2600);
  }

  useEffect(() => {
    return () => {
      if (mousePromptTimerRef.current !== null) {
        window.clearTimeout(mousePromptTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const laneWidth = window.innerWidth / PHYSICS_SHAPE_BLUEPRINTS.length;
    const shuffledLanes = PHYSICS_SHAPE_BLUEPRINTS
      .map((_, index) => index)
      .sort(() => Math.random() - 0.5);

    physicsShapesRef.current = PHYSICS_SHAPE_BLUEPRINTS.map((shape, index) => ({
      ...shape,
      x: Math.min(
        window.innerWidth - shape.size - 16,
        Math.max(16, shuffledLanes[index] * laneWidth + laneWidth * (0.22 + Math.random() * 0.42))
      ),
      y: -120 - index * 96 - Math.random() * 140,
      vx: (Math.random() - 0.5) * 4,
      vy: Math.random() * 1.2,
      rotation: Math.random() * 32 - 16,
      angularVelocity: Math.random() * 4 - 2,
    }));

    function renderShape(shape: PhysicsShape) {
      const element = physicsShapeRefs.current[shape.id];
      if (!element) return;

      element.style.transform = `translate3d(${shape.x}px, ${shape.y}px, 0) rotate(${shape.rotation}deg)`;
    }

    function tickPhysics() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const floor = height - 20;
      const currentFingerPoints = indexFingerPointsRef.current;
      const previousFingerPoints = previousIndexFingerPointsRef.current;
      const fingerVelocities = currentFingerPoints.map((currentFingerPoint, handIndex) => {
        const previousFingerPoint = previousFingerPoints[handIndex];

        if (!currentFingerPoint) {
          return lastFingerVelocitiesRef.current[handIndex] ?? { vx: 0, vy: 0 };
        }

        if (!previousFingerPoint || currentFingerPoint.time === previousFingerPoint.time) {
          return lastFingerVelocitiesRef.current[handIndex] ?? { vx: 0, vy: 0 };
        }

        const dt = Math.max(16, currentFingerPoint.time - previousFingerPoint.time);
        const velocity = {
          vx: (currentFingerPoint.x - previousFingerPoint.x) / dt * 16,
          vy: (currentFingerPoint.y - previousFingerPoint.y) / dt * 16,
        };

        lastFingerVelocitiesRef.current[handIndex] = velocity;
        return velocity;
      });
      const buttonRects = [playgroundButtonRef.current, signingButtonRef.current]
        .map((button) => button?.getBoundingClientRect())
        .filter((rect): rect is DOMRect => Boolean(rect));
      const activeShapeIds = [...activeDragShapeIdsRef.current];
      const previousActiveShapeIds = [...activeShapeIds];
      const releaseVelocities = new Map<number, FingerVelocity>();

      currentFingerPoints.forEach((currentFingerPoint, handIndex) => {
        const previousActiveShapeId = previousActiveShapeIds[handIndex];

        if (!currentFingerPoint) {
          if (previousActiveShapeId !== null) {
            releaseVelocities.set(
              previousActiveShapeId,
              lastDraggedShapeVelocitiesRef.current[previousActiveShapeId] ??
                lastFingerVelocitiesRef.current[handIndex] ??
                { vx: 0, vy: 0 }
            );
          }

          activeShapeIds[handIndex] = null;
          return;
        }

        const fingerVelocity = fingerVelocities[handIndex] ?? { vx: 0, vy: 0 };
        const speed = Math.hypot(fingerVelocity.vx, fingerVelocity.vy);

        if (speed > THROW_RELEASE_SPEED) {
          const activeShapeId = activeShapeIds[handIndex];
          if (activeShapeId !== null) {
            releaseVelocities.set(
              activeShapeId,
              lastDraggedShapeVelocitiesRef.current[activeShapeId] ?? fingerVelocity
            );
          }

          activeShapeIds[handIndex] = null;
          dragReleaseUntilRef.current[handIndex] = currentFingerPoint.time + THROW_RELEASE_COOLDOWN_MS;
          return;
        }

        if (currentFingerPoint.time < dragReleaseUntilRef.current[handIndex]) {
          activeShapeIds[handIndex] = null;
          return;
        }

        const activeShapeId = activeShapeIds[handIndex];
        if (activeShapeId && physicsShapesRef.current.some((shape) => shape.id === activeShapeId)) return;

        const grabbedShapeIds = new Set(activeShapeIds.filter((shapeId): shapeId is number => shapeId !== null));
        const nearestShape = physicsShapesRef.current
          .filter((shape) => !grabbedShapeIds.has(shape.id))
          .map((shape) => {
            const centerX = shape.x + shape.size / 2;
            const centerY = shape.y + shape.size / 2;
            return {
              shape,
              distance: Math.hypot(currentFingerPoint.x - centerX, currentFingerPoint.y - centerY),
            };
          })
          .filter(({ distance }) => distance < FINGER_GRAB_RADIUS)
          .sort((firstShape, secondShape) => firstShape.distance - secondShape.distance)[0]?.shape;

        if (nearestShape) {
          activeShapeIds[handIndex] = nearestShape.id;
        }
      });

      activeDragShapeIdsRef.current = activeShapeIds;

      const nextShapes = physicsShapesRef.current.map((shape) => {
        const nextShape = { ...shape };
        const activeHandIndex = activeShapeIds.findIndex((shapeId) => shapeId === shape.id);
        const currentFingerPoint = activeHandIndex >= 0 ? currentFingerPoints[activeHandIndex] : null;
        const releaseVelocity = releaseVelocities.get(shape.id);
        const fingerVelocity = activeHandIndex >= 0
          ? fingerVelocities[activeHandIndex] ?? { vx: 0, vy: 0 }
          : { vx: nextShape.vx, vy: nextShape.vy };

        if (currentFingerPoint) {
          nextShape.x += (currentFingerPoint.x - nextShape.size / 2 - nextShape.x) * 0.42;
          nextShape.y += (currentFingerPoint.y - nextShape.size / 2 - nextShape.y) * 0.42;
          nextShape.vx = fingerVelocity.vx;
          nextShape.vy = fingerVelocity.vy;
          lastDraggedShapeVelocitiesRef.current[shape.id] = fingerVelocity;
          nextShape.angularVelocity = Math.max(-12, Math.min(12, fingerVelocity.vx * 0.35));
        } else {
          if (releaseVelocity) {
            nextShape.vx = releaseVelocity.vx;
            nextShape.vy = releaseVelocity.vy;
            nextShape.angularVelocity = Math.max(-12, Math.min(12, releaseVelocity.vx * 0.35));
          }

          nextShape.vy += PHYSICS_GRAVITY;
          nextShape.x += nextShape.vx;
          nextShape.y += nextShape.vy;
          nextShape.vx *= PHYSICS_FRICTION;
          nextShape.vy *= PHYSICS_FRICTION;
          nextShape.rotation += nextShape.angularVelocity;
          nextShape.angularVelocity *= 0.992;
        }

        if (nextShape.x < 0) {
          nextShape.x = 0;
          nextShape.vx = Math.abs(nextShape.vx) * PHYSICS_BOUNCE;
          nextShape.angularVelocity *= -0.8;
        } else if (nextShape.x + nextShape.size > width) {
          nextShape.x = width - nextShape.size;
          nextShape.vx = -Math.abs(nextShape.vx) * PHYSICS_BOUNCE;
          nextShape.angularVelocity *= -0.8;
        }

        if (!activeShapeIds.includes(shape.id)) {
          for (const rect of buttonRects) {
            const shapeRight = nextShape.x + nextShape.size;
            const shapeBottom = nextShape.y + nextShape.size;
            const isColliding = (
              shapeRight > rect.left &&
              nextShape.x < rect.right &&
              shapeBottom > rect.top &&
              nextShape.y < rect.bottom
            );

            if (!isColliding) continue;

            const overlapLeft = shapeRight - rect.left;
            const overlapRight = rect.right - nextShape.x;
            const overlapTop = shapeBottom - rect.top;
            const overlapBottom = rect.bottom - nextShape.y;
            const minOverlap = Math.min(overlapLeft, overlapRight, overlapTop, overlapBottom);

            if (minOverlap === overlapLeft) {
              nextShape.x = rect.left - nextShape.size;
              nextShape.vx = -Math.abs(nextShape.vx) * PHYSICS_BOUNCE;
            } else if (minOverlap === overlapRight) {
              nextShape.x = rect.right;
              nextShape.vx = Math.abs(nextShape.vx) * PHYSICS_BOUNCE;
            } else if (minOverlap === overlapTop) {
              nextShape.y = rect.top - nextShape.size;
              nextShape.vy = -Math.abs(nextShape.vy) * PHYSICS_BOUNCE;
              nextShape.vx *= 0.92;
            } else {
              nextShape.y = rect.bottom;
              nextShape.vy = Math.abs(nextShape.vy) * PHYSICS_BOUNCE;
            }

            nextShape.angularVelocity += nextShape.vx * 0.12;
          }
        }

        if (nextShape.y + nextShape.size > floor) {
          nextShape.y = floor - nextShape.size;
          nextShape.vy = -Math.abs(nextShape.vy) * PHYSICS_BOUNCE;
          nextShape.vx *= 0.86;
          nextShape.angularVelocity *= 0.82;
        } else if (nextShape.y < 0) {
          nextShape.y = 0;
          nextShape.vy = Math.abs(nextShape.vy) * PHYSICS_BOUNCE;
        }

        return nextShape;
      });

      for (let firstIndex = 0; firstIndex < nextShapes.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < nextShapes.length; secondIndex++) {
          const firstShape = nextShapes[firstIndex];
          const secondShape = nextShapes[secondIndex];
          const firstCenterX = firstShape.x + firstShape.size / 2;
          const firstCenterY = firstShape.y + firstShape.size / 2;
          const secondCenterX = secondShape.x + secondShape.size / 2;
          const secondCenterY = secondShape.y + secondShape.size / 2;
          const dx = secondCenterX - firstCenterX;
          const dy = secondCenterY - firstCenterY;
          const distance = Math.max(0.001, Math.hypot(dx, dy));
          const minDistance = (firstShape.size + secondShape.size) / 2;

          if (distance >= minDistance) continue;

          const nx = dx / distance;
          const ny = dy / distance;
          const overlap = minDistance - distance;
          const firstGrabbed = activeShapeIds.includes(firstShape.id);
          const secondGrabbed = activeShapeIds.includes(secondShape.id);

          if (!firstGrabbed) {
            firstShape.x -= nx * overlap * (secondGrabbed ? 1 : 0.5);
            firstShape.y -= ny * overlap * (secondGrabbed ? 1 : 0.5);
          }

          if (!secondGrabbed) {
            secondShape.x += nx * overlap * (firstGrabbed ? 1 : 0.5);
            secondShape.y += ny * overlap * (firstGrabbed ? 1 : 0.5);
          }

          if (!firstGrabbed && !secondGrabbed) {
            const firstVx = firstShape.vx;
            const firstVy = firstShape.vy;

            firstShape.vx = secondShape.vx * PHYSICS_BOUNCE;
            firstShape.vy = secondShape.vy * PHYSICS_BOUNCE;
            secondShape.vx = firstVx * PHYSICS_BOUNCE;
            secondShape.vy = firstVy * PHYSICS_BOUNCE;
            firstShape.angularVelocity += (firstShape.vx - secondShape.vx) * 0.08;
            secondShape.angularVelocity += (secondShape.vx - firstShape.vx) * 0.08;
          }
        }
      }

      nextShapes.forEach(renderShape);
      physicsShapesRef.current = nextShapes;
      previousIndexFingerPointsRef.current = currentFingerPoints.map((point) => (
        point ? { ...point } : null
      ));
      physicsAnimationRef.current = requestAnimationFrame(tickPhysics);
    }

    tickPhysics();

    return () => {
      if (physicsAnimationRef.current) {
        cancelAnimationFrame(physicsAnimationRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/hands.js";
    script.onload = () => setIsLoaded(true);
    document.body.appendChild(script);

    return () => {
      document.body.removeChild(script);
    };
  }, []);

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

    function isPointInsideButton(point: { x: number; y: number }, button: HTMLAnchorElement | null) {
      if (!button) return false;

      const rect = button.getBoundingClientRect();
      return (
        point.x >= rect.left &&
        point.x <= rect.right &&
        point.y >= rect.top &&
        point.y <= rect.bottom
      );
    }

    function getButtonPinchPoint(landmarks: HandLandmark[], width: number, height: number) {
      const thumbTip = getCanvasPoint(landmarks[THUMB_TIP], width, height);
      const indexTip = getCanvasPoint(landmarks[INDEX_TIP], width, height);
      const pinchDistance = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);

      if (pinchDistance > BUTTON_PINCH_THRESHOLD) return null;

      return {
        x: (thumbTip.x + indexTip.x) / 2,
        y: (thumbTip.y + indexTip.y) / 2,
      };
    }

    const hands = new window.Hands({
      locateFile: (file: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`,
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
      let nextIsHandHoveringPlayground = false;
      let nextIsHandHoveringSigning = false;
      let isPinchingPlayground = false;
      let isPinchingSigning = false;
      const nextIndexFingerPoints: Array<FingerPoint | null> = [null, null];
      const nextHasDetectedHands = Boolean(results.multiHandLandmarks?.length);

      ctx.save();
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#00FF00";
      ctx.lineWidth = 2;
      ctx.fillStyle = "#FF0000";

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        for (let handIndex = 0; handIndex < results.multiHandLandmarks.length; handIndex++) {
          const landmarks = results.multiHandLandmarks[handIndex];

          for (const [start, end] of HAND_CONNECTIONS) {
            const startPoint = getCanvasPoint(landmarks[start], width, height);
            const endPoint = getCanvasPoint(landmarks[end], width, height);

            ctx.beginPath();
            ctx.moveTo(startPoint.x, startPoint.y);
            ctx.lineTo(endPoint.x, endPoint.y);
            ctx.stroke();
          }

          for (const landmark of landmarks) {
            const canvasPoint = getCanvasPoint(landmark, width, height);

            ctx.beginPath();
            ctx.arc(canvasPoint.x, canvasPoint.y, 3, 0, 2 * Math.PI);
            ctx.fill();
          }

          const indexPoint = getCanvasPoint(landmarks[INDEX_TIP], width, height);

          if (isPointInsideButton(indexPoint, playgroundButtonRef.current)) {
            nextIsHandHoveringPlayground = true;
          }

          if (isPointInsideButton(indexPoint, signingButtonRef.current)) {
            nextIsHandHoveringSigning = true;
          }

          const buttonPinchPoint = getButtonPinchPoint(landmarks, width, height);
          if (buttonPinchPoint && handIndex < nextIndexFingerPoints.length) {
            nextIndexFingerPoints[handIndex] = {
              ...indexPoint,
              time: performance.now(),
            };
          }

          if (buttonPinchPoint && isPointInsideButton(buttonPinchPoint, playgroundButtonRef.current)) {
            nextIsHandHoveringPlayground = true;
            isPinchingPlayground = true;
          }

          if (buttonPinchPoint && isPointInsideButton(buttonPinchPoint, signingButtonRef.current)) {
            nextIsHandHoveringSigning = true;
            isPinchingSigning = true;
          }
        }
      }

      indexFingerPointsRef.current = nextIndexFingerPoints;
      setHasDetectedHands(nextHasDetectedHands);
      setIsHandHoveringPlayground(nextIsHandHoveringPlayground);
      setIsHandHoveringSigning(nextIsHandHoveringSigning);
      if (isPinchingPlayground && !hasNavigatedToPlaygroundRef.current) {
        const now = performance.now();
        const pinchStartTime = playgroundPinchStartRef.current ?? now;
        const elapsed = now - pinchStartTime;
        const nextProgress = Math.min(1, elapsed / BUTTON_PINCH_HOLD_MS);

        playgroundPinchStartRef.current = pinchStartTime;
        setPlaygroundPinchProgress(nextProgress);

        if (nextProgress >= 1) {
          hasNavigatedToPlaygroundRef.current = true;
          router.push("/playground");
        }
      } else {
        playgroundPinchStartRef.current = null;
        setPlaygroundPinchProgress(0);
      }

      if (isPinchingSigning && !hasNavigatedToSigningRef.current) {
        const now = performance.now();
        const pinchStartTime = signingPinchStartRef.current ?? now;
        const elapsed = now - pinchStartTime;
        const nextProgress = Math.min(1, elapsed / BUTTON_PINCH_HOLD_MS);

        signingPinchStartRef.current = pinchStartTime;
        setSigningPinchProgress(nextProgress);

        if (nextProgress >= 1) {
          hasNavigatedToSigningRef.current = true;
          router.push("/signing");
        }
      } else {
        signingPinchStartRef.current = null;
        setSigningPinchProgress(0);
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
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      if (handsRef.current) {
        handsRef.current.close();
      }
    };
  }, [isLoaded, router]);

  return (
    <div className="canvas-container">
      <video
        ref={videoRef}
        style={{ display: "none" }}
        autoPlay
        playsInline
      />
      <canvas ref={canvasRef} className={styles.handCanvas} />
      <div className={styles.physicsLayer} aria-hidden="true">
        {PHYSICS_SHAPE_BLUEPRINTS.map((shape) => (
          <div
            key={shape.id}
            ref={(element) => {
              physicsShapeRefs.current[shape.id] = element;
            }}
            className={`${styles.physicsShape} ${
              shape.type === "circle"
                ? styles.physicsShapeCircle
                : styles.physicsShapeSquare
            }`}
            style={{
              width: `${shape.size}px`,
              height: `${shape.size}px`,
            }}
          />
        ))}
      </div>
      {isIntroVisible && !hasDetectedHands && (
        <div className={styles.introPopup} role="dialog" aria-label="Camera hand tracking tip">
          <div className={styles.introHand} aria-hidden="true">
            <span />
            <span />
            <span />
            <span />
            <span />
          </div>
          <div className={styles.introText}>
            <strong>USE YOUR HANDS</strong>
            <span>Hover a button with your hand, then pinch and hold to jump in.</span>
            <span>Also pinch and throw the shapes around on the home screen!</span>
          </div>
          <button
            className={styles.introButton}
            type="button"
            tabIndex={-1}
            aria-disabled="true"
          >
            Got it
          </button>
        </div>
      )}
      {mousePrompt && (
        <div className={styles.mousePrompt} role="status" aria-live="polite">
          {mousePrompt}
        </div>
      )}
      <div className={styles.buttonGroup}>
        {shouldShowActions && (
          <div className={styles.actionPanel}>
            {handActions.map((action) => (
              <div key={action.title} className={styles.actionCard}>
                <strong>{action.title}</strong>
                <span>{action.text}</span>
              </div>
            ))}
          </div>
        )}
        {shouldShowSigningActions && (
          <div className={`${styles.actionPanel} ${styles.signingActionPanel}`}>
            {signingActions.map((action) => (
              <div key={action.title} className={styles.actionCard}>
                <strong>{action.title}</strong>
                <span>{action.text}</span>
              </div>
            ))}
          </div>
        )}
        <a
          ref={playgroundButtonRef}
          href="/playground"
          className={`${styles.button} ${shouldShowActions ? styles.buttonActive : ""}`}
          style={{ "--pinch-progress": playgroundPinchProgress } as React.CSSProperties}
          tabIndex={-1}
          aria-disabled="true"
          onClick={(event) => {
            event.preventDefault();
            showMousePrompt("Shape Playground");
          }}
        >
          <span className={styles.buttonProgress} />
          <span className={styles.buttonLabel}>Shape Playground</span>
        </a>
        <a
          ref={signingButtonRef}
          href="/signing"
          className={`${styles.button} ${shouldShowSigningActions ? styles.buttonActive : ""}`}
          style={{ "--pinch-progress": signingPinchProgress } as React.CSSProperties}
          tabIndex={-1}
          aria-disabled="true"
          onClick={(event) => {
            event.preventDefault();
            showMousePrompt("Signing");
          }}
        >
          <span className={styles.buttonProgress} />
          <span className={styles.buttonLabel}>Signing</span>
        </a>
      </div>
    </div>
  );
}
