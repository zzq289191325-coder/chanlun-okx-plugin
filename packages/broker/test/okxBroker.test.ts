import { describe, expect, it } from "vitest";
import type { ExecutionPermit, OrderIntent } from "../../broker-contracts/src/index.js";
import { OkxBroker, type CredentialProvider, type OkxTransport } from "../src/okxBroker.js";
import { redactCredentialText, signOkxRequest } from "../src/okxSigner.js";

const credentials = { apiKey: "key-secret", secret: "sign-secret", passphrase: "pass-secret" };
const provider: CredentialProvider = { load: async () => credentials, clear: () => undefined };
const transport: OkxTransport = { request: async <T>() => ({ code: "0", msg: "", data: [{ perm: "read_only", totalEq: "1000", availEq: "1000" }] }) as T };

function intent(): OrderIntent {
  return { clientOrderId: "live-1", accountMode: "LIVE", strategyId: "aggressive", strategyVersion: "1", signalId: null, symbol: "BTC-USDT-SWAP", side: "buy", positionSide: "long", orderType: "market", quantity: "0.001", referencePrice: "100", limitPrice: null, reduceOnly: false, candidateLabel: "候选1买", locationTime: 1, confirmedAt: 2, dataCutoff: 3, createdAt: 4 };
}

describe("locked OKX adapters", () => {
  it("uses the stable HMAC signature vector and redacts every credential", () => {
    expect(signOkxRequest("2020-12-08T09:08:57.715Z", "GET", "/api/v5/account/balance", "", "22582BD0CFF14C41EDBF1AB98506286D")).toBe("AkD5YszBhggtIyjDlmTy/9PpNVntel+1Lff8wh0qpQw=");
    expect(redactCredentialText("key-secret sign-secret pass-secret", credentials)).toBe("[REDACTED] [REDACTED] [REDACTED]");
  });

  it("keeps LIVE execution disabled even after a read-only connection", async () => {
    const broker = new OkxBroker({ mode: "LIVE", transport, credentialProvider: provider, executionCompiled: false, clock: () => 10 });
    await broker.connect();
    broker.unlockForSession("UNLOCK LIVE");
    const preview = await broker.previewOrder(intent());
    const permit: ExecutionPermit = { previewId: preview.previewId, accountMode: "LIVE", approvedAt: 10, expiresAt: 20, humanConfirmed: true, nonce: "once" };
    await expect(broker.placeOrder(preview, permit)).rejects.toThrow("not compiled");
    expect((await broker.healthCheck()).readOnly).toBe(true);
  });
});
