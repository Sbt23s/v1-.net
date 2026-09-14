import { describe, it, expect } from "vitest";
import { cn, initials, monthName, formatMoney, minutesToHours } from "./utils";

describe("cn", () => {
  it("merges and dedupes tailwind classes", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-red-500", "font-bold")).toBe("text-red-500 font-bold");
  });

  it("filters falsy values", () => {
    expect(cn("a", null, undefined, false, "b")).toBe("a b");
  });
});

describe("initials", () => {
  it("handles empty input", () => {
    expect(initials()).toBe("?");
    expect(initials("")).toBe("?");
  });

  it("takes first letters of up to two words", () => {
    expect(initials("Sethuraman Balasubramanian")).toBe("SB");
    expect(initials("alice")).toBe("A");
  });

  it("uppercases and skips empty tokens", () => {
    expect(initials("  john   doe ")).toBe("JD");
  });
});

describe("monthName", () => {
  it("maps 1..12 to English month names", () => {
    expect(monthName(1)).toBe("January");
    expect(monthName(12)).toBe("December");
  });

  it("falls back to the number for out-of-range values", () => {
    expect(monthName(0)).toBe("0");
    expect(monthName(13)).toBe("13");
  });
});

describe("formatMoney", () => {
  it("formats INR with Indian digit grouping", () => {
    expect(formatMoney(100000)).toBe("₹1,00,000.00");
    expect(formatMoney(0)).toBe("₹0.00");
  });

  it("accepts numeric strings and non-finite values", () => {
    expect(formatMoney("5000")).toBe("₹5,000.00");
    expect(formatMoney(undefined)).toBe("₹0.00");
  });
});

describe("minutesToHours", () => {
  it("formats whole hours and minutes", () => {
    expect(minutesToHours(90)).toBe("1h 30m");
    expect(minutesToHours(480)).toBe("8h 0m");
  });

  it("returns em dash for missing or non-positive values", () => {
    expect(minutesToHours(null)).toBe("—");
    expect(minutesToHours(0)).toBe("—");
    expect(minutesToHours(-5)).toBe("—");
  });
});
