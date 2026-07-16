import type { ReactNode } from "react";

export type EditorStatus = {
  message: string;
  tone: EditorStatusTone;
};

export type EditorStatusTone = "attention" | "ready" | "unknown";

export function StatusPill({
  icon,
  label,
  tone,
}: {
  icon?: ReactNode;
  label: string;
  tone: "attention" | "neutral" | "ready" | "warn";
}) {
  const toneClass =
    tone === "attention"
      ? "border-[#7D2633] bg-[#FFE3E8] text-[#7D2633]"
      : tone === "ready"
        ? "border-[#5E7200] bg-[#F1FFD0] text-[#3B5200]"
        : tone === "warn"
          ? "border-[#8A6D00] bg-[#FFF2B8] text-[#4D3D00]"
          : "border-[#747A60] bg-[#EEEEEE] text-[#444933]";
  return (
    <span
      className={`inline-flex min-h-8 items-center gap-1.5 border px-3 text-xs font-black ${toneClass}`}
    >
      {icon}
      <span>{label}</span>
    </span>
  );
}

export function StatusLine({
  detail,
  icon,
  title,
  tone,
}: {
  detail: string;
  icon: ReactNode;
  title: string;
  tone: EditorStatusTone;
}) {
  const toneClass =
    tone === "attention"
      ? "border-[#7D2633] bg-[#FFE3E8] text-[#7D2633]"
      : tone === "ready"
        ? "border-[#5E7200] bg-[#F1FFD0] text-[#3B5200]"
        : "border-[#747A60] bg-[#EEEEEE] text-[#444933]";
  return (
    <div
      className={`flex min-w-0 gap-3 border p-3 ${toneClass}`}
      role={tone === "attention" ? "alert" : "status"}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <div className="truncate text-sm font-black text-[#1B1B1B]">{title}</div>
        <div className="mt-1 break-words text-sm leading-5">{detail}</div>
      </div>
    </div>
  );
}
