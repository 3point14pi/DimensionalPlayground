"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import HandTracking from "../components/HandTracking";
import styles from "./page.module.css";

const PLAYGROUND_TUTORIAL_STORAGE_KEY = "dimensional-playground-tutorial-seen";

const tutorialSteps = [
  {
    id: "drag",
    title: "Drag",
    text: "Pinch the rectangle, move your hand, then let go to drop it.",
  },
  {
    id: "resize",
    title: "Resize",
    text: "Pinch a corner or side point and pull to change the shape.",
  },
  {
    id: "zoom",
    title: "Zoom",
    text: "Use two pinches on the same shape and spread your hands apart or together.",
  },
  {
    id: "depth",
    title: "Z axis",
    text: "Touch your middle finger to your thumb on a shape, then move your hand forward or back to change depth.",
  },
  {
    id: "delete",
    title: "Delete",
    text: "Touch your pinky to your thumb on a shape to remove it from the playground.",
  },
];

export default function Home() {
  const hideTimerRef = useRef<number | null>(null);
  const [isHomeLinkVisible, setIsHomeLinkVisible] = useState(true);
  const [isTutorialVisible, setIsTutorialVisible] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const tutorialStep = tutorialSteps[tutorialStepIndex];

  useEffect(() => {
    function showHomeLinkTemporarily() {
      setIsHomeLinkVisible(true);

      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }

      hideTimerRef.current = window.setTimeout(() => {
        setIsHomeLinkVisible(false);
      }, 3000);
    }

    showHomeLinkTemporarily();
    window.addEventListener("mousemove", showHomeLinkTemporarily);

    return () => {
      window.removeEventListener("mousemove", showHomeLinkTemporarily);
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (window.localStorage.getItem(PLAYGROUND_TUTORIAL_STORAGE_KEY)) return;

    setIsTutorialVisible(true);
  }, []);

  function closeTutorial() {
    window.localStorage.setItem(PLAYGROUND_TUTORIAL_STORAGE_KEY, "true");
    setIsTutorialVisible(false);
  }

  function replayTutorial() {
    setTutorialStepIndex(0);
    setIsTutorialVisible(true);
  }

  function goToNextStep() {
    if (tutorialStepIndex === tutorialSteps.length - 1) {
      closeTutorial();
      return;
    }

    setTutorialStepIndex((currentStep) => currentStep + 1);
  }

  function goToPreviousStep() {
    setTutorialStepIndex((currentStep) => Math.max(0, currentStep - 1));
  }

  return (
    <div className="canvas-container">
      <Link href="/" className={`${styles.homeLink} ${isHomeLinkVisible ? styles.homeLinkVisible : ""}`}>
        ←
      </Link>
      <div className="grid-overlay" />
      <HandTracking onReplayTutorial={replayTutorial} />
      {isTutorialVisible && (
        <div className={styles.tutorialOverlay} role="dialog" aria-label="Playground tutorial">
          <div className={styles.tutorialDemo} data-step={tutorialStep.id} aria-hidden="true">
            <div className={styles.tutorialDepthShadow} />
            <div className={styles.tutorialRectangle}>
              <span className={`${styles.tutorialHandle} ${styles.tutorialHandleTopLeft}`} />
              <span className={`${styles.tutorialHandle} ${styles.tutorialHandleTopRight}`} />
              <span className={`${styles.tutorialHandle} ${styles.tutorialHandleBottomLeft}`} />
              <span className={`${styles.tutorialHandle} ${styles.tutorialHandleBottomRight}`} />
            </div>
            <span className={`${styles.tutorialFinger} ${styles.tutorialFingerOne}`} />
            <span className={`${styles.tutorialFinger} ${styles.tutorialFingerTwo}`} />
            <span className={styles.tutorialDeletePulse} />
          </div>
          <div className={styles.tutorialCopy}>
            <span className={styles.tutorialCount}>
              {tutorialStepIndex + 1} / {tutorialSteps.length}
            </span>
            <h2>{tutorialStep.title}</h2>
            <p>{tutorialStep.text}</p>
            <div className={styles.tutorialDots} aria-hidden="true">
              {tutorialSteps.map((step, index) => (
                <span
                  key={step.id}
                  className={index === tutorialStepIndex ? styles.tutorialDotActive : ""}
                />
              ))}
            </div>
            <div className={styles.tutorialActions}>
              {tutorialStepIndex > 0 && (
                <button type="button" className={styles.tutorialSecondaryButton} onClick={goToPreviousStep}>
                  Back
                </button>
              )}
              <button type="button" className={styles.tutorialPrimaryButton} onClick={goToNextStep}>
                {tutorialStepIndex === tutorialSteps.length - 1 ? "Start playing" : "Next"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
