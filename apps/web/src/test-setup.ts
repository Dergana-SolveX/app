import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
afterEach(cleanup);
Object.defineProperty(SVGSVGElement.prototype, "createSVGRect", {
  configurable: true,
  value: () => ({}),
});
class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = TestResizeObserver;
