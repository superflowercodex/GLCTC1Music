import { afterEach, describe, expect, it } from "vitest";
import { uiStore } from "../store/project";
import { answerRequest, choiceSheet, confirmQueue, confirmSheet, promptSheet } from "./confirm";

afterEach(() => {
  confirmQueue.set({ requests: [] });
  uiStore.set((s) => ({ ...s, sheet: null }));
});

const top = () => confirmQueue.get().requests[0];

describe("confirmSheet", () => {
  it("opens the confirm sheet and resolves true on confirm", async () => {
    const pending = confirmSheet({ title: "Delete?", confirmLabel: "Delete", danger: true });
    expect(uiStore.get().sheet).toBe("confirm");
    expect(top().choices[0]).toMatchObject({ id: "confirm", label: "Delete", tone: "danger" });
    expect(top().icon).toBe("danger");
    answerRequest(top().id, { choice: "confirm", text: "" });
    await expect(pending).resolves.toBe(true);
    expect(uiStore.get().sheet).toBeNull();
  });

  it("resolves false when cancelled", async () => {
    const pending = confirmSheet({ title: "Sure?" });
    answerRequest(top().id, null);
    await expect(pending).resolves.toBe(false);
  });

  it("queues questions instead of overwriting them", async () => {
    const first = confirmSheet({ title: "One" });
    const second = confirmSheet({ title: "Two" });
    expect(top().title).toBe("One");
    answerRequest(top().id, { choice: "confirm", text: "" });
    await expect(first).resolves.toBe(true);
    expect(uiStore.get().sheet).toBe("confirm");
    expect(top().title).toBe("Two");
    answerRequest(top().id, null);
    await expect(second).resolves.toBe(false);
    expect(uiStore.get().sheet).toBeNull();
  });

  it("puts back the sheet that was open before", async () => {
    uiStore.set((s) => ({ ...s, sheet: "export" }));
    const pending = confirmSheet({ title: "Over 10 minutes" });
    expect(uiStore.get().sheet).toBe("confirm");
    answerRequest(top().id, null);
    await pending;
    expect(uiStore.get().sheet).toBe("export");
  });
});

describe("choiceSheet and promptSheet", () => {
  it("returns the chosen id", async () => {
    const pending = choiceSheet({ title: "Same name", choices: [{ id: "both", label: "Keep both" }, { id: "replace", label: "Replace" }] });
    answerRequest(top().id, { choice: "replace", text: "" });
    await expect(pending).resolves.toBe("replace");
  });

  it("returns the typed text", async () => {
    const pending = promptSheet({ title: "Name", label: "Name", initial: "Untitled" });
    expect(top().field?.initial).toBe("Untitled");
    answerRequest(top().id, { choice: "ok", text: "Cosmic Lift" });
    await expect(pending).resolves.toBe("Cosmic Lift");
  });

  it("returns null when a prompt is cancelled", async () => {
    const pending = promptSheet({ title: "Name", label: "Name" });
    answerRequest(top().id, null);
    await expect(pending).resolves.toBeNull();
  });

  it("ignores answers for requests that are gone", () => {
    expect(() => answerRequest(99999, null)).not.toThrow();
  });
});
