"use client";

import { Loader2 } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ControlCenterButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "children"
> & {
  busy?: boolean;
  busyLabel?: string;
  children?: ReactNode;
  fullWidth?: boolean;
  icon?: ReactNode;
  label?: string;
  size?: "default" | "large" | "compact";
  variant?: "primary" | "secondary";
};

export function ControlCenterButton({
  busy = false,
  busyLabel,
  children,
  className = "",
  disabled,
  fullWidth = false,
  icon,
  label,
  size = "default",
  type = "button",
  variant = "primary",
  ...props
}: ControlCenterButtonProps) {
  const isDisabled = Boolean(disabled || busy);
  const sizeClass =
    size === "large"
      ? "vibetv-button--large"
      : size === "compact"
        ? "vibetv-button--compact"
        : "vibetv-button--default";
  const widthClass = fullWidth ? "vibetv-button--full" : "";
  const variantClass =
    isDisabled
      ? "vibetv-button--disabled"
      : variant === "primary"
        ? "vibetv-button--primary"
        : "vibetv-button--secondary";

  return (
    <button
      className={`vibetv-button ${sizeClass} ${widthClass} ${variantClass} ${className}`}
      disabled={isDisabled}
      type={type}
      {...props}
    >
      {busy ? <Loader2 className="animate-spin" size={18} aria-hidden /> : icon}
      <span>{busy ? busyLabel || label : children || label}</span>
    </button>
  );
}
