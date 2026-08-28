"use client";

import { useState } from "react";
import { CircleAlert } from "lucide-react";
import { SetupDialog } from "./setup-dialog";
import type { SetupLogLine } from "./setup-log";
import { SetupWelcomeScreen } from "./setup-welcome-screen";

const WELCOME_LINES: SetupLogLine[] = [
  { id: "service", text: "starting background service", tone: "done" },
  { id: "usage", text: "reading provider usage on this Mac", tone: "done" },
  { id: "wifi", text: "scanning your WiFi", tone: "done" },
  { id: "device", text: "looking for your VibeTV" },
];

type Entry = { id: string; label: string; render: () => React.ReactNode };

/**
 * Development-only gallery for the setup steps, mirroring the internal UI kit
 * route. It is how each screen is checked against the design before the wizard
 * is wired into the app.
 */
export function SetupPreviewGallery() {
  const [active, setActive] = useState("01");
  const [dialogOpen, setDialogOpen] = useState(true);

  const entries: Entry[] = [
    {
      id: "01",
      label: "01 · Welcome",
      render: () => <SetupWelcomeScreen lines={WELCOME_LINES} />,
    },
    {
      id: "dialog",
      label: "Dialog shell",
      render: () => (
        <>
          <SetupWelcomeScreen lines={WELCOME_LINES} />
          <SetupDialog
            description="It was found, but the connection could not be completed. Keep VibeTV powered on, then search again."
            icon={CircleAlert}
            onOpenChange={setDialogOpen}
            open={dialogOpen}
            primaryAction={{ label: "Search again", onSelect: () => undefined }}
            secondaryAction={{
              label: "Enter IP manually",
              onSelect: () => undefined,
            }}
            title="VibeTV could not connect"
          />
        </>
      ),
    },
  ];

  const current = entries.find((entry) => entry.id === active) ?? entries[0];

  return (
    <div className="min-h-svh bg-muted">
      <nav className="fixed top-2 left-1/2 z-70 flex -translate-x-1/2 flex-wrap gap-2 rounded-full bg-foreground/90 p-1.5 shadow-lg">
        {entries.map((entry) => (
          <button
            className={
              entry.id === active
                ? "rounded-full bg-background px-3 py-1 text-xs font-semibold text-foreground"
                : "rounded-full px-3 py-1 text-xs font-semibold text-background/70 hover:text-background"
            }
            key={entry.id}
            onClick={() => {
              setActive(entry.id);
              setDialogOpen(true);
            }}
            type="button"
          >
            {entry.label}
          </button>
        ))}
      </nav>
      <div className="relative">{current.render()}</div>
    </div>
  );
}
