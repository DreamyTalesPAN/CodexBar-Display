import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DeviceCandidateList } from "./setup-device-components";

describe("DeviceCandidateList", () => {
  it.each([1, 2])("uses the same Item list for %i discovered device(s)", (count) => {
    const html = renderToStaticMarkup(
      <DeviceCandidateList
        candidates={Array.from({ length: count }, (_, index) => ({
          deviceId: `device-${index + 1}`,
          known: index === 0,
          target: `http://192.168.1.${index + 10}`,
        }))}
        onSelect={vi.fn()}
      />,
    );

    expect(html).toContain('data-slot="item-group"');
    expect(html.match(/data-slot="item"/g)).toHaveLength(count);
    expect(html.match(/>Connect<\/span>/g)).toHaveLength(count);
  });
});
