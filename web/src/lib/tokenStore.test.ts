import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tokenStore } from "./api";

/**
 * The technical-admin console and the employee portal are two sign-ins served
 * from one origin. localStorage is shared across every tab of an origin, so a
 * single pair of keys meant signing into either one ended the other's session
 * -- in the same window and in any other tab that happened to be open.
 */
describe("tokenStore keeps the two portals apart", () => {
  const setPath = (p: string) => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: p },
      writable: true,
      configurable: true
    });
  };

  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("does not let the console overwrite the employee session", () => {
    setPath("/employees");
    tokenStore.set("employee-token", "employee-refresh");

    setPath("/tech-admin/dashboard");
    tokenStore.set("tech-token", "");

    // Each side still reads back its own.
    expect(tokenStore.access).toBe("tech-token");
    setPath("/employees");
    expect(tokenStore.access).toBe("employee-token");
    expect(tokenStore.refresh).toBe("employee-refresh");
  });

  it("signing out of one portal leaves the other signed in", () => {
    setPath("/employees");
    tokenStore.set("employee-token", "employee-refresh");
    setPath("/tech-admin/dashboard");
    tokenStore.set("tech-token", "");

    tokenStore.clear(); // sign out of the console

    expect(tokenStore.access).toBeNull();
    setPath("/employees");
    expect(tokenStore.access).toBe("employee-token");
  });
});
