"use client";

import HandTracking from "../components/HandTracking";

export default function Home() {
  return (
    <div className="canvas-container">
      <div className="grid-overlay" />
      <HandTracking />
    </div>
  );
}
