// @vitest-environment jsdom
//
// Calm type: the shared Button, Card and Label use the one 13 px body size
// (token text-body) and the 600 weight for titles and labels, and cn keeps
// that size when a caller adds a text colour.
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

afterEach(cleanup);

it("renders shared buttons, cards and labels with the 13 px body token", () => {
  render(
    <>
      <Button>Save</Button>
      <Card data-testid="card">
        <CardTitle>Card title</CardTitle>
        <CardDescription>Card text</CardDescription>
      </Card>
      <Label>Field name</Label>
    </>,
  );

  const button = screen.getByRole("button", { name: "Save" });
  expect(button.classList).toContain("text-body");
  expect(button.classList).not.toContain("text-sm");

  const card = screen.getByTestId("card");
  expect(card.classList).toContain("text-body");
  expect(card.classList).not.toContain("text-sm");

  const title = screen.getByText("Card title");
  expect(title.classList).toContain("text-body");
  expect(title.classList).toContain("font-semibold");
  expect(title.classList).not.toContain("font-medium");

  const description = screen.getByText("Card text");
  expect(description.classList).toContain("text-body");

  const label = screen.getByText("Field name");
  expect(label.classList).toContain("text-body");
  expect(label.classList).toContain("font-semibold");
  expect(label.classList).not.toContain("font-medium");
});

it("keeps the 13 px body token when a caller adds a text colour", () => {
  expect(cn("text-body", "text-muted-foreground")).toBe(
    "text-body text-muted-foreground",
  );
});

it("fills the whole box of a lime button: the fill runs under the transparent border", () => {
  render(<Button>Connect</Button>);
  const button = screen.getByRole("button", { name: "Connect" });
  expect(button.classList).toContain("bg-clip-border");
  expect(button.classList).not.toContain("bg-clip-padding");
  expect(button.classList).not.toContain("border-primary");
});
