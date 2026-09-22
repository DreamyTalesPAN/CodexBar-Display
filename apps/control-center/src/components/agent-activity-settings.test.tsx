// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  AgentActivitySettings,
  type AgentSettingsRequest,
} from "./agent-activity-settings";
const items = [
  {
    id: "vibetv.agents.enabled",
    type: "boolean",
    label: "Show agent activity",
    value: true,
  },
  {
    id: "vibetv.agents.blink",
    type: "boolean",
    label: "Blink the screen when an agent needs you",
    value: true,
  },
  {
    id: "vibetv.agents.reminder",
    type: "enum",
    label: "Remind me again",
    value: "5",
    options: [
      { value: "5", label: "After 5 minutes" },
      { value: "15", label: "After 15 minutes" },
      { value: "never", label: "Never" },
    ],
  },
  {
    id: "vibetv.agents.quiet",
    type: "enum",
    label: "Quiet from",
    value: "off",
    options: [{ value: "off", label: "Never quiet" }],
  },
  {
    id: "vibetv.agents.doneDuration",
    type: "enum",
    label: "Keep ‘Done’ on screen",
    value: "30",
    options: [{ value: "30", label: "30 seconds" }, { value: "120", label: "2 minutes" }],
  },
].map((item) => ({
  ...item,
  writable: true,
  availability: { state: "available" },
}));
afterEach(cleanup);
it("saves the master switch, disables dependent controls, and keeps failed writes visible", async () => {
  const request = vi
    .fn()
    .mockResolvedValueOnce({ items })
    .mockResolvedValueOnce({ item: { ...items[0], value: false } })
    .mockRejectedValueOnce(new Error("offline"));
  render(<AgentActivitySettings request={request as AgentSettingsRequest} />);
  const master = await screen.findByRole("switch", {
    name: "Show agent activity",
  });
  fireEvent.click(master);
  await waitFor(() =>
    expect(master.getAttribute("aria-checked")).toBe("false"),
  );
  expect(request).toHaveBeenLastCalledWith(
    "/v1/preferences/vibetv.agents.enabled",
    { method: "PATCH", body: '{"value":false}' },
  );
  expect(
    screen
      .getByRole("combobox", { name: "Remind me again" })
      .hasAttribute("disabled"),
  ).toBe(true);
  fireEvent.click(master);
  await screen.findByRole("dialog");
  expect(master.getAttribute("aria-checked")).toBe("false");
});
it("shows load failures and retries without inventing settings", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ items });
  render(<AgentActivitySettings request={request as AgentSettingsRequest} />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  await screen.findByRole("switch", { name: "Show agent activity" });
  expect(request).toHaveBeenCalledTimes(2);
});

it("keeps done duration available when blinking is off", async () => {
 const request = vi.fn().mockResolvedValueOnce({items:items.map(item=>item.id==="vibetv.agents.blink"?{...item,value:false}:item)});
 render(<AgentActivitySettings request={request as AgentSettingsRequest}/>);
 const duration=await screen.findByRole("combobox",{name:"Keep ‘Done’ on screen"});
 expect(duration.hasAttribute("disabled")).toBe(false);
 expect(duration.textContent).toContain("30 seconds");
 expect(screen.getByRole("combobox",{name:"Remind me again"}).hasAttribute("disabled")).toBe(true);
});
