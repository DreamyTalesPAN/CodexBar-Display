import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

function stubManifest(manifest: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
}

function firmwareRequest(board: string, firmware: string): Request {
  const url = new URL("http://localhost/api/firmware/latest");
  url.searchParams.set("board", board);
  url.searchParams.set("firmware", firmware);
  return new Request(url);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GET /api/firmware/latest", () => {
  it("offers the final release to an installed RC", async () => {
    stubManifest({
      release: "v1.0.36",
      artifacts: [
        { board: "esp8266_smalltv_st7789", firmwareVersion: "1.0.36" },
      ],
    });

    const response = await GET(
      firmwareRequest("esp8266_smalltv_st7789", "1.0.36-rc.2"),
    );
    const body = await response.json();
    expect(body.updateAvailable).toBe(true);
    expect(body.status).toBe("update_available");
    expect(body.latestFirmware).toBe("1.0.36");
  });

  it("keeps the exact final release current", async () => {
    stubManifest({
      release: "v1.0.36",
      artifacts: [
        { board: "esp8266_smalltv_st7789", firmwareVersion: "1.0.36" },
      ],
    });

    const response = await GET(
      firmwareRequest("esp8266_smalltv_st7789", "1.0.36"),
    );
    const body = await response.json();
    expect(body.updateAvailable).toBe(false);
    expect(body.status).toBe("current");
  });

  it("fails visibly for a malformed installed version", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const response = await GET(
      firmwareRequest("esp8266_smalltv_st7789", "banana"),
    );
    const body = await response.json();
    expect(body.updateAvailable).toBe(false);
    expect(body.status).toBe("check_failed");
    expect(body.message).toContain("banana");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("skips malformed manifest versions and sorts by SemVer precedence", async () => {
    stubManifest({
      release: "v1.0.37",
      artifacts: [
        { board: "esp8266_smalltv_st7789", firmwareVersion: "broken" },
        { board: "esp8266_smalltv_st7789", firmwareVersion: "1.0.37-rc.1" },
        { board: "esp8266_smalltv_st7789", firmwareVersion: "1.0.37" },
        { board: "other_board", firmwareVersion: "9.9.9" },
      ],
    });

    const response = await GET(
      firmwareRequest("esp8266_smalltv_st7789", "1.0.36"),
    );
    const body = await response.json();
    expect(body.latestFirmware).toBe("1.0.37");
    expect(body.updateAvailable).toBe(true);
  });
});
