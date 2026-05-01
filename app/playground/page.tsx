"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import HandTracking, { type TutorialGesture } from "../components/HandTracking";
import styles from "./page.module.css";

const PLAYGROUND_TUTORIAL_STORAGE_KEY = "dimensional-playground-tutorial-seen";

const tutorialSteps = [
  {
    id: "drag",
    title: "Drag",
    text: "If the canvas is empty, pinch Rectangle in the toolbar first. Then touch your thumb and index finger together over a shape, keep pinching, move your hand across the canvas, and open your fingers to let go.",
    requirement: "Move a real shape while holding an index pinch.",
    success: "Nice. You moved a shape with your hand.",
    gesture: "drag",
  },
  {
    id: "resize",
    title: "Resize",
    text: "Hover near one of the red resize handles. Pinch the handle with your index finger and thumb, then pull away from the shape until its size changes.",
    requirement: "Resize a real shape by dragging one handle.",
    success: "Good. The handle resize is unlocked.",
    gesture: "resize",
  },
  {
    id: "zoom",
    title: "Zoom",
    text: "Put both hands over the same shape. Pinch with thumb and index finger on both hands, then spread your hands apart or bring them closer together.",
    requirement: "Scale one real shape with two simultaneous pinches.",
    success: "Yep. Two-hand zoom is working.",
    gesture: "zoom",
  },
  {
    id: "depth",
    title: "Z axis",
    text: "Touch your middle finger to your thumb while over a shape. Keep that middle pinch held and move your hand toward or away from the camera to change the z value.",
    requirement: "Change a real shape's depth with a middle-finger pinch.",
    success: "Depth changed. That shape can now move in z.",
    gesture: "depth",
  },
  {
    id: "duplicate",
    title: "Duplicate",
    text: "Place your hand over a shape and touch your ring finger to your thumb. The shape should copy itself once, slightly offset from the original.",
    requirement: "Duplicate a real shape with a ring-finger pinch.",
    success: "Copied. Ring pinch can duplicate shapes.",
    gesture: "duplicate",
  },
  {
    id: "delete",
    title: "Delete",
    text: "Place your hand over a shape and touch your pinky to your thumb. The shape should disappear immediately when the pinky pinch lands on it.",
    requirement: "Delete a real shape with a pinky pinch.",
    success: "Deleted. Pinky pinch removes one shape.",
    gesture: "delete",
  },
  {
    id: "clear",
    title: "Clear all",
    text: "Make fists with both hands and hold them up together. Keep both fists closed until the countdown finishes and every shape clears.",
    requirement: "Hold two fists for the full clear countdown.",
    success: "Cleared. Tutorial complete.",
    gesture: "clear",
  },
] satisfies Array<{
  id: TutorialGesture;
  title: string;
  text: string;
  requirement: string;
  success: string;
  gesture: TutorialGesture;
}>;

export default function Home() {
  const hideTimerRef = useRef<number | null>(null);
  const [isHomeLinkVisible, setIsHomeLinkVisible] = useState(true);
  const [isTutorialVisible, setIsTutorialVisible] = useState(false);
  const [tutorialStepIndex, setTutorialStepIndex] = useState(0);
  const [completedTutorialSteps, setCompletedTutorialSteps] = useState<TutorialGesture[]>([]);
  const tutorialStep = tutorialSteps[tutorialStepIndex];
  const isCurrentStepComplete = completedTutorialSteps.includes(tutorialStep.gesture);

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
    setCompletedTutorialSteps([]);
    setIsTutorialVisible(true);
  }

  function goToNextStep() {
    if (!isCurrentStepComplete) return;

    if (tutorialStepIndex === tutorialSteps.length - 1) {
      closeTutorial();
      return;
    }

    setTutorialStepIndex((currentStep) => currentStep + 1);
  }

  function goToPreviousStep() {
    setTutorialStepIndex((currentStep) => Math.max(0, currentStep - 1));
  }

  function skipTutorialStep() {
    if (tutorialStepIndex === tutorialSteps.length - 1) {
      closeTutorial();
      return;
    }

    setTutorialStepIndex((currentStep) => currentStep + 1);
  }

  const handleTutorialGesture = useCallback((gesture: TutorialGesture) => {
    if (!isTutorialVisible || gesture !== tutorialStep.gesture) return;

    setCompletedTutorialSteps((currentSteps) => (
      currentSteps.includes(gesture) ? currentSteps : [...currentSteps, gesture]
    ));
  }, [isTutorialVisible, tutorialStep.gesture]);

  return (
    <div className="canvas-container">
      <Link href="/" className={`${styles.homeLink} ${isHomeLinkVisible ? styles.homeLinkVisible : ""}`}>
        ←
      </Link>
      <div className="grid-overlay" />
      <HandTracking onReplayTutorial={replayTutorial} onTutorialGesture={handleTutorialGesture} />
      {isTutorialVisible && (
        <div className={styles.tutorialOverlay} role="dialog" aria-label="Playground tutorial">
          <div className={styles.tutorialDemo} data-step={tutorialStep.id} aria-hidden="true">
            <div className={styles.tutorialDepthShadow} />
            <div className={styles.tutorialDuplicateRectangle} />
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
            <div className={`${styles.tutorialRequirement} ${isCurrentStepComplete ? styles.tutorialRequirementComplete : ""}`}>
              <strong>{isCurrentStepComplete ? "Done" : "Your turn"}</strong>
              <span>{isCurrentStepComplete ? tutorialStep.success : tutorialStep.requirement}</span>
            </div>
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
              <button type="button" className={styles.tutorialSecondaryButton} onClick={skipTutorialStep}>
                {tutorialStepIndex === tutorialSteps.length - 1 ? "Skip tutorial" : "Skip"}
              </button>
              <button
                type="button"
                className={styles.tutorialPrimaryButton}
                disabled={!isCurrentStepComplete}
                onClick={goToNextStep}
              >
                {isCurrentStepComplete
                  ? tutorialStepIndex === tutorialSteps.length - 1
                    ? "Start playing"
                    : "Next"
                  : "Do the motion"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
