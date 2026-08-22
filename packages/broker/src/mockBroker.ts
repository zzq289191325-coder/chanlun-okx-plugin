import { PaperBroker, type PaperBrokerOptions } from "./paperBroker.js";

export interface MockBrokerOptions extends PaperBrokerOptions {
  failNextOperation?: boolean;
}

export class MockBroker extends PaperBroker {
  #failNext: boolean;
  constructor(options: MockBrokerOptions = {}) { super(options); this.#failNext = options.failNextOperation ?? false; }
  failNext(): void { this.#failNext = true; }
  override async connect(): Promise<void> {
    if (this.#failNext) { this.#failNext = false; throw new Error("Mock broker timeout"); }
    await super.connect();
  }
}
