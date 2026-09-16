import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UpdatesScreen } from "./updates-screen";
import { OverviewScreen } from "./overview-screen";
import { LogsScreen } from "./logs-screen";

describe("Windows platform presentation", () => {
  it("does not identify a connected Windows support session as a Mac", () => {
    const html = renderToStaticMarkup(<LogsScreen device={{connected:true,ready:true}} />);
    expect(html).toContain("controlled by this computer");
    expect(html).not.toContain("this Mac");
  });
  it("labels a failed app check as a retry even when firmware is available", () => {
    const html = renderToStaticMarkup(<UpdatesScreen companionStatus="online"
      device={{ connected: true, firmware: "1.0.39" }}
      companionInfo={{app:{platform:"windows",version:"1.0.0",installedInApplications:true}}}
      companionRelease={{checkedAt:"2026-09-10T08:00:00Z",status:"missing_asset",updateAvailable:false}}
      firmwareUpdate={{checkedAt:"2026-09-10T08:00:00Z",installedFirmware:"1.0.39",latestFirmware:"1.0.42",updateAvailable:true,status:"update_available"}}
      onCheckUpdates={() => {}} />);
    expect(html).toContain(">Check again</span>");
    expect(html).not.toContain(">Update</span>");
  });

  it("does not advertise a missing Windows release as current or offer a Mac download", () => {
    const html = renderToStaticMarkup(<UpdatesScreen companionStatus="online" device={null}
      companionInfo={{app:{platform:"windows",version:"1.0.0",installedInApplications:true}}}
      companionRelease={{checkedAt:"2026-09-10T08:00:00Z",status:"missing_asset",updateAvailable:false,message:"No published Windows update is available yet."}} />);
    expect(html).toContain("Windows App");
    expect(html).toContain("No published Windows update is available yet.");
    expect(html).not.toContain("Software running on this Mac");
    expect(html).not.toContain(">Up to date</h2>");
    expect(html).not.toContain(".dmg");
  });
  it("labels the installed Windows runtime correctly", () => {
    const html = renderToStaticMarkup(<OverviewScreen companionPlatform="windows" companionStatus="online" device={null} />);
    expect(html).toContain("Windows App");
    expect(html).not.toContain(">Mac App<");
  });
});
