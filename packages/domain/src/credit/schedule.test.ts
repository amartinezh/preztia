import { describe, it, expect } from "vitest";
import { Money } from "../shared/money";
import { buildSchedule } from "./schedule";

describe("buildSchedule", () => {
  it("la suma de cuotas es exactamente el total (sin perder centavos)", () => {
    const principal = Money.of(70000000, "COP"); // 700.000,00
    const sched = buildSchedule(principal, 200, 20); // 20% en 20 cuotas
    const sum = sched.reduce((a, i) => a + i.amountDueMinor, 0);
    expect(sum).toBe(84000000); // 840.000,00
    expect(sched).toHaveLength(20);
  });
});
