import { describe, it, expect, beforeEach } from "vitest";
import type { PaymentPlan, TextMessage } from "@preztiaos/domain";
import {
  RecordPlanReplyHandler,
  type ActiveOfferSnapshot,
  type PlanReplyStore,
} from "./record-plan-reply";
import type { PaymentPlanStore } from "./ports";
import type { PlanOfferNotifier } from "./offer-plans";

const PLAN_A: PaymentPlan = {
  id: "plan-a",
  tenantId: "t1",
  name: "Plan 20 días",
  installmentsCount: 20,
  frequency: "DAILY",
  interestPct: 200,
  isActive: true,
  isDefault: true,
};

// Doble del store: devuelve un snapshot fijo y registra las transiciones aplicadas.
class FakeStore implements PlanReplyStore {
  constructor(public offer: ActiveOfferSnapshot | null) {}
  selections: string[] = [];
  accepts = 0;
  declines = 0;
  async findActiveOffer(): Promise<ActiveOfferSnapshot | null> {
    return this.offer;
  }
  async recordSelection(i: { offeredPlanId: string }): Promise<void> {
    this.selections.push(i.offeredPlanId);
  }
  async recordAcceptance(): Promise<void> {
    this.accepts += 1;
  }
  async recordDecline(): Promise<void> {
    this.declines += 1;
  }
}

const plans: PaymentPlanStore = {
  listActive: async () => [PLAN_A],
} as unknown as PaymentPlanStore;

// Doble del notifier: cuenta cada tipo de mensaje saliente.
class FakeNotifier implements PlanOfferNotifier {
  calls: string[] = [];
  async sendPlanMenu() { this.calls.push("menu"); }
  async sendScheduleForAcceptance() { this.calls.push("schedule"); }
  async sendSelectionReask() { this.calls.push("selectionReask"); }
  async sendAcceptanceReask() { this.calls.push("acceptanceReask"); }
  async sendAcknowledgement() { this.calls.push("ack"); }
  async sendOfferExpired() { this.calls.push("expired"); }
}

const message = (body: string): TextMessage => ({
  id: "wamid-1",
  from: "573001112233",
  channelId: "chan-1",
  receivedAt: new Date(),
  kind: "text",
  body,
});

const NOW = new Date("2026-06-16T12:00:00Z");
const future = new Date("2026-06-17T12:00:00Z");

function awaitingSelection(): ActiveOfferSnapshot {
  return { tenantId: "t1", applicationId: "app-1", planOffer: "AWAITING_SELECTION", offeredPrincipalMinor: 1_000_00, offerExpiresAt: future };
}
function awaitingAcceptance(): ActiveOfferSnapshot {
  return { tenantId: "t1", applicationId: "app-1", planOffer: "AWAITING_ACCEPTANCE", offeredPrincipalMinor: 1_000_00, offerExpiresAt: future };
}

let notifier: FakeNotifier;
let seen: Set<string>;
const dedup = {
  firstSeen: async (i: { messageId: string }) => {
    if (seen.has(i.messageId)) return false;
    seen.add(i.messageId);
    return true;
  },
};

beforeEach(() => {
  notifier = new FakeNotifier();
  seen = new Set();
});

function handlerFor(store: FakeStore) {
  return new RecordPlanReplyHandler(store, plans, notifier, dedup, "COP", () => NOW);
}

describe("RecordPlanReplyHandler", () => {
  it("no intercepta cuando no hay oferta activa (lo atiende el asistente)", async () => {
    const store = new FakeStore(null);
    expect(await handlerFor(store).handle(message("hola"))).toBe(false);
    expect(notifier.calls).toEqual([]);
  });

  it("registra la selección válida y envía el cronograma para aceptación", async () => {
    const store = new FakeStore(awaitingSelection());
    expect(await handlerFor(store).handle(message("1"))).toBe(true);
    expect(store.selections).toEqual(["plan-a"]);
    expect(notifier.calls).toEqual(["schedule"]);
  });

  it("re-pregunta si la selección no se entiende, sin transicionar", async () => {
    const store = new FakeStore(awaitingSelection());
    expect(await handlerFor(store).handle(message("ninguno"))).toBe(true);
    expect(store.selections).toEqual([]);
    expect(notifier.calls).toEqual(["selectionReask"]);
  });

  it("acepta el crédito ante un SÍ", async () => {
    const store = new FakeStore(awaitingAcceptance());
    expect(await handlerFor(store).handle(message("sí, acepto"))).toBe(true);
    expect(store.accepts).toBe(1);
    expect(notifier.calls).toEqual(["ack"]);
  });

  it("rechaza el crédito ante un NO", async () => {
    const store = new FakeStore(awaitingAcceptance());
    await handlerFor(store).handle(message("no"));
    expect(store.declines).toBe(1);
    expect(notifier.calls).toEqual(["ack"]);
  });

  it("ignora la respuesta si la oferta venció", async () => {
    const store = new FakeStore({ ...awaitingAcceptance(), offerExpiresAt: new Date("2026-06-15T12:00:00Z") });
    expect(await handlerFor(store).handle(message("sí"))).toBe(true);
    expect(store.accepts).toBe(0);
    expect(notifier.calls).toEqual(["expired"]);
  });

  it("es idempotente: un mismo wamid no se procesa dos veces", async () => {
    const store = new FakeStore(awaitingAcceptance());
    const handler = handlerFor(store);
    await handler.handle(message("sí"));
    await handler.handle(message("sí"));
    expect(store.accepts).toBe(1);
    expect(notifier.calls).toEqual(["ack"]);
  });
});
