"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import Signing from "../components/Signing";

export default function SigningPage() {
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
    <>
      <Link href="/" className={`home-link ${isHomeLinkVisible ? "home-link-visible" : ""}`}>
        ←
      </Link>
      <Signing />
    </>
  );
}
