"use client";

import { useEffect, useRef, useState } from "react";
import styles from "../signing/page.module.css";

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
type RecognizedSign = { word: string; confidence: number; source: "pose" | "motion" };
type MotionSample = {
  time: number;
  wrist: { x: number; y: number };
  indexTip: { x: number; y: number };
  handSize: number;
};

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

const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_TIP = 20;
const DEMO_POSE_COUNT = 11;
const DEMO_MOTION_COUNT = 6;
const MOTION_HISTORY_MS = 1300;
const RECOGNITION_COOLDOWN_MS = 1100;

function getDistance(pointA: { x: number; y: number }, pointB: { x: number; y: number }) {
  return Math.hypot(pointA.x - pointB.x, pointA.y - pointB.y);
}

function getCanvasPoint(landmark: HandLandmark, width: number, height: number) {
  return {
    x: (1 - landmark.x) * width,
    y: landmark.y * height,
  };
}

function isFingerExtended(landmarks: HandLandmark[], tipIndex: number, mcpIndex: number) {
  return landmarks[tipIndex].y < landmarks[mcpIndex].y;
}

function recognizeDemoSign(landmarks: HandLandmark[], width: number, height: number): RecognizedSign | null {
  const wrist = getCanvasPoint(landmarks[WRIST], width, height);
  const thumbTip = getCanvasPoint(landmarks[THUMB_TIP], width, height);
  const indexMcp = getCanvasPoint(landmarks[INDEX_MCP], width, height);
  const indexTip = getCanvasPoint(landmarks[INDEX_TIP], width, height);
  const indexExtended = isFingerExtended(landmarks, INDEX_TIP, INDEX_MCP);
  const middleExtended = isFingerExtended(landmarks, MIDDLE_TIP, MIDDLE_MCP);
  const ringExtended = isFingerExtended(landmarks, RING_TIP, RING_MCP);
  const pinkyExtended = isFingerExtended(landmarks, PINKY_TIP, PINKY_MCP);
  const pinchDistance = getDistance(thumbTip, indexTip);
  const handSize = Math.max(1, getDistance(wrist, getCanvasPoint(landmarks[MIDDLE_MCP], width, height)));
  const thumbOut = getDistance(thumbTip, indexMcp) / handSize > 0.72;
  const fingerPattern = [indexExtended, middleExtended, ringExtended, pinkyExtended].map(Boolean).join("");

  if (pinchDistance / handSize < 0.35) return { word: "select", confidence: 0.66, source: "pose" };
  if (thumbOut && indexExtended && !middleExtended && !ringExtended && pinkyExtended) {
    return { word: "love", confidence: 0.7, source: "pose" };
  }
  if (thumbOut && !indexExtended && !middleExtended && !ringExtended && pinkyExtended) {
    return { word: "call", confidence: 0.68, source: "pose" };
  }
  if (thumbOut && !indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
    return { word: "good", confidence: 0.64, source: "pose" };
  }
  if (fingerPattern === "truetruefalsetrue") return { word: "three", confidence: 0.7, source: "pose" };
  if (fingerPattern === "truetruetruetrue") return { word: "hello", confidence: 0.74, source: "pose" };
  if (fingerPattern === "truefalsefalsefalse") return { word: "one", confidence: 0.72, source: "pose" };
  if (indexExtended && middleExtended && !ringExtended && !pinkyExtended) return { word: "peace", confidence: 0.71, source: "pose" };
  if (indexExtended && middleExtended && ringExtended && !pinkyExtended) return { word: "three", confidence: 0.7, source: "pose" };
  if (!indexExtended && !middleExtended && !ringExtended && !pinkyExtended) return { word: "yes", confidence: 0.69, source: "pose" };
  if (!indexExtended && !middleExtended && !ringExtended && pinkyExtended) return { word: "small", confidence: 0.62, source: "pose" };

  return null;
}

function getMotionSample(landmarks: HandLandmark[], width: number, height: number): MotionSample {
  const wrist = getCanvasPoint(landmarks[WRIST], width, height);
  const indexTip = getCanvasPoint(landmarks[INDEX_TIP], width, height);
  const middleMcp = getCanvasPoint(landmarks[MIDDLE_MCP], width, height);

  return {
    time: performance.now(),
    wrist,
    indexTip,
    handSize: Math.max(1, getDistance(wrist, middleMcp)),
  };
}

function countDirectionChanges(values: number[]) {
  let changes = 0;
  let previousDirection = 0;

  for (let index = 1; index < values.length; index++) {
    const delta = values[index] - values[index - 1];
    const direction = Math.abs(delta) < 5 ? 0 : Math.sign(delta);

    if (direction !== 0 && previousDirection !== 0 && direction !== previousDirection) {
      changes++;
    }

    if (direction !== 0) {
      previousDirection = direction;
    }
  }

  return changes;
}

function recognizeMotion(samples: MotionSample[]): RecognizedSign | null {
  if (samples.length < 8) return null;

  const firstSample = samples[0];
  const lastSample = samples[samples.length - 1];
  const averageHandSize = samples.reduce((total, sample) => total + sample.handSize, 0) / samples.length;
  const dx = lastSample.wrist.x - firstSample.wrist.x;
  const dy = lastSample.wrist.y - firstSample.wrist.y;
  const horizontalTravel = Math.max(...samples.map((sample) => sample.wrist.x)) - Math.min(...samples.map((sample) => sample.wrist.x));
  const verticalTravel = Math.max(...samples.map((sample) => sample.wrist.y)) - Math.min(...samples.map((sample) => sample.wrist.y));
  const indexHorizontalTravel = Math.max(...samples.map((sample) => sample.indexTip.x)) - Math.min(...samples.map((sample) => sample.indexTip.x));
  const directionChanges = countDirectionChanges(samples.map((sample) => sample.wrist.x));
  const normalizedDx = dx / averageHandSize;
  const normalizedDy = dy / averageHandSize;
  const normalizedHorizontalTravel = horizontalTravel / averageHandSize;
  const normalizedVerticalTravel = verticalTravel / averageHandSize;
  const normalizedIndexTravel = indexHorizontalTravel / averageHandSize;

  if (directionChanges >= 2 && normalizedIndexTravel > 1.1) {
    return { word: "hello", confidence: 0.82, source: "motion" };
  }

  if (Math.abs(normalizedDx) > 1.15 && normalizedHorizontalTravel > normalizedVerticalTravel * 1.6) {
    return {
      word: normalizedDx > 0 ? "move right" : "move left",
      confidence: 0.76,
      source: "motion",
    };
  }

  if (Math.abs(normalizedDy) > 1 && normalizedVerticalTravel > normalizedHorizontalTravel * 1.4) {
    return {
      word: normalizedDy > 0 ? "down" : "up",
      confidence: 0.74,
      source: "motion",
    };
  }

  if (normalizedHorizontalTravel > 0.8 && normalizedVerticalTravel > 0.8) {
    return { word: "around", confidence: 0.68, source: "motion" };
  }

  return null;
}

export default function Signing() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationRef = useRef<number>(0);
  const handsRef = useRef<MediaPipeHands | null>(null);
  const motionSamplesRef = useRef<MotionSample[]>([]);
  const lastRecognizedAtRef = useRef(0);
  const lastWordRef = useRef("");
  const [isLoaded, setIsLoaded] = useState(false);
  const [status, setStatus] = useState("Loading hand tracker");
  const [currentWord, setCurrentWord] = useState("No sign detected");
  const [confidence, setConfidence] = useState(0);
  const [recognitionSource, setRecognitionSource] = useState<RecognizedSign["source"] | null>(null);
  const [transcript, setTranscript] = useState<string[]>([]);

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
      let detectedWord: RecognizedSign | null = null;
      let motionWord: RecognizedSign | null = null;

      ctx.save();
      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#00FF00";
      ctx.lineWidth = 2;
      ctx.fillStyle = "#FF0000";

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        setStatus("Tracking hands");

        for (const landmarks of results.multiHandLandmarks) {
          const now = performance.now();
          const nextMotionSamples = [
            ...motionSamplesRef.current,
            getMotionSample(landmarks, width, height),
          ].filter((sample) => now - sample.time <= MOTION_HISTORY_MS);

          motionSamplesRef.current = nextMotionSamples;
          motionWord ??= recognizeMotion(nextMotionSamples);

          for (const [start, end] of HAND_CONNECTIONS) {
            const startPoint = getCanvasPoint(landmarks[start], width, height);
            const endPoint = getCanvasPoint(landmarks[end], width, height);

            ctx.beginPath();
            ctx.moveTo(startPoint.x, startPoint.y);
            ctx.lineTo(endPoint.x, endPoint.y);
            ctx.stroke();
          }

          for (const landmark of landmarks) {
            const point = getCanvasPoint(landmark, width, height);

            ctx.beginPath();
            ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
            ctx.fill();
          }

          detectedWord ??= recognizeDemoSign(landmarks, width, height);
        }
      } else {
        motionSamplesRef.current = [];
        setStatus("Show your hand to the camera");
      }

      detectedWord = motionWord ?? detectedWord;

      if (detectedWord) {
        const now = performance.now();

        setCurrentWord(detectedWord.word);
        setConfidence(detectedWord.confidence);
        setRecognitionSource(detectedWord.source);

        if (
          detectedWord.word !== lastWordRef.current ||
          now - lastRecognizedAtRef.current > RECOGNITION_COOLDOWN_MS
        ) {
          lastWordRef.current = detectedWord.word;
          lastRecognizedAtRef.current = now;
          setTranscript((currentTranscript) => [...currentTranscript.slice(-17), detectedWord.word]);
        }
      } else {
        setCurrentWord("No sign detected");
        setConfidence(0);
        setRecognitionSource(null);
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
        setStatus("Tracking hands");
        processFrame();
      } catch (err) {
        console.error("Error accessing camera:", err);
        setStatus("Camera access failed");
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
  }, [isLoaded]);

  return (
    <main className={styles.signingPage}>
      <video ref={videoRef} className={styles.video} autoPlay playsInline muted />
      <canvas ref={canvasRef} className={styles.handCanvas} />
      <section className={styles.outputPanel}>
        <div className={styles.statusRow}>
          <span>{status}</span>
          <span>{DEMO_POSE_COUNT} pose rules + {DEMO_MOTION_COUNT} motion rules</span>
        </div>
        <div className={styles.currentWord}>
          {currentWord}
        </div>
        <div className={styles.sourceRow}>
          {recognitionSource ? `Detected from ${recognitionSource}` : "Waiting for pose or motion"}
        </div>
        <div className={styles.confidenceBar} aria-label={`Confidence ${Math.round(confidence * 100)} percent`}>
          <span style={{ transform: `scaleX(${confidence})` }} />
        </div>
        <p className={styles.modelNote}>
          This is not a 1,000-word sign-language model yet. Live landmarks are running, and this demo maps simple poses plus motion patterns like wave, swipe, up, down, and around. Real vocabulary recognition needs a trained sequence model.
        </p>
        <div className={styles.transcript}>
          {transcript.length > 0 ? transcript.join(" ") : "Detected words will appear here"}
        </div>
      </section>
    </main>
  );
}
