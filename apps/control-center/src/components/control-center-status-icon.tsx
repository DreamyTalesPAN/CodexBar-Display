"use client";

import type { ReactNode } from "react";

type ControlCenterStatusIconProps = {
  children: ReactNode;
  size?: "step" | "hero";
  variant?: "active" | "complete" | "neutral" | "pending";
};

export function ControlCenterStatusIcon({
  children,
  size = "hero",
  variant = "neutral",
}: ControlCenterStatusIconProps) {
  const sizeClass =
    size === "step" ? "vibetv-status-icon--step" : "vibetv-status-icon--hero";
  const variantClass = `vibetv-status-icon--${variant}`;

  return (
    <div className={`vibetv-status-icon ${sizeClass} ${variantClass}`}>
      {children}
    </div>
  );
}
