"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import HandTracking from "../components/HandTracking";
import styles from "./page.module.css";

export default function Home() {
  const hideTimerRef = useRef<number | null>(null);
  const [isHomeLinkVisible, setIsHomeLinkVisible] = useState(true);

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

  return (
    <div className="canvas-container">
        <h1></h1>
      <Link href="/" className={`${styles.homeLink} ${isHomeLinkVisible ? styles.homeLinkVisible : ""}`}>
        ←
      </Link>
      <div className="grid-overlay" />
      <HandTracking />
    </div>
  );
}
