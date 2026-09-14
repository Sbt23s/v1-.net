import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Vitest is run with globals off, so RTL cannot register its automatic
// cleanup on its own — without this, rendered DOM leaks across tests.
afterEach(() => cleanup());
