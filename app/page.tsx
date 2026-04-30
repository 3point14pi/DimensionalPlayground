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

const handActions = [
  {
    title: "Pinch",
    text: "Grab, move, resize, and create shapes.",
  },
  {
    title: "Middle pinch",
    text: "Push shapes forward and backward in depth.",
  },
  {
    title: "Pinky pinch",
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
  const handsRef = useRef<MediaPipeHands | null>(null);
  const playgroundPinchStartRef = useRef<number | null>(null);
  const signingPinchStartRef = useRef<number | null>(null);
  const hasNavigatedToPlaygroundRef = useRef(false);
  const hasNavigatedToSigningRef = useRef(false);
  const [isLoaded, setIsLoaded] = useState(false);
  const [isMouseHoveringPlayground, setIsMouseHoveringPlayground] = useState(false);
  const [isMouseHoveringSigning, setIsMouseHoveringSigning] = useState(false);
  const [isHandHoveringPlayground, setIsHandHoveringPlayground] = useState(false);
  const [isHandHoveringSigning, setIsHandHoveringSigning] = useState(false);
  const [playgroundPinchProgress, setPlaygroundPinchProgress] = useState(0);
  const [signingPinchProgress, setSigningPinchProgress] = useState(0);
  const activeDescription: ActiveDescription = isMouseHoveringPlayground
    ? "playground"
    : isMouseHoveringSigning
      ? "signing"
      : isHandHoveringPlayground
        ? "playground"
        : isHandHoveringSigning
          ? "signing"
          : null;
  const shouldShowActions = activeDescription === "playground";
  const shouldShowSigningActions = activeDescription === "signing";

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
      return {
        x: (1 - landmark.x) * width,
        y: landmark.y * height,
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

      ctx.save();
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#00FF00";
      ctx.lineWidth = 2;
      ctx.fillStyle = "#FF0000";

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        for (const landmarks of results.multiHandLandmarks) {
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
          onMouseEnter={() => setIsMouseHoveringPlayground(true)}
          onMouseLeave={() => setIsMouseHoveringPlayground(false)}
        >
          <span className={styles.buttonProgress} />
          <span className={styles.buttonLabel}>Shape Playground</span>
        </a>
        <a
          ref={signingButtonRef}
          href="/signing"
          className={`${styles.button} ${shouldShowSigningActions ? styles.buttonActive : ""}`}
          style={{ "--pinch-progress": signingPinchProgress } as React.CSSProperties}
          onMouseEnter={() => setIsMouseHoveringSigning(true)}
          onMouseLeave={() => setIsMouseHoveringSigning(false)}
        >
          <span className={styles.buttonProgress} />
          <span className={styles.buttonLabel}>Signing</span>
        </a>
      </div>
    </div>
  );
}
