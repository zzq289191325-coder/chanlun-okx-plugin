import { describe, expect, it } from "vitest";
import { modeRequest } from "./modePolicy.js";

describe("desktop account mode isolation", () => {
  it("starts with PAPER available and keeps DEMO/LIVE locked", () => {
    expect(modeRequest("PAPER").accepted).toBe(true);
    expect(modeRequest("DEMO").accepted).toBe(false);
    expect(modeRequest("LIVE").accepted).toBe(false);
  });
});
