import { describe, it, expect } from "vitest";
import { todayIso, thisMonthIso, to12Hour } from "./dates";

describe("to12Hour", () => {
  it("converts 24-hour times to 12-hour with AM/PM", () => {
    expect(to12Hour("14:30")).toBe("2:30 PM");
    expect(to12Hour("09:05")).toBe("9:05 AM");
    expect(to12Hour("00:00")).toBe("12:00 AM");
    expect(to12Hour("12:00")).toBe("12:00 PM");
  });

  it("pads single-digit minutes", () => {
    expect(to12Hour("08:5")).toBe("8:05 AM");
  });

  it("returns em dash for empty input", () => {
    expect(to12Hour(undefined)).toBe("—");
    expect(to12Hour(null)).toBe("—");
    expect(to12Hour("")).toBe("—");
  });

  it("returns input untouched when it is not parseable", () => {
    expect(to12Hour("banana")).toBe("banana");
  });
});

describe("todayIso / thisMonthIso", () => {
  it("returns today in the format <input type=date> expects", () => {
    expect(todayIso()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns this month in the format <input type=month> expects", () => {
    expect(thisMonthIso()).toMatch(/^\d{4}-\d{2}$/);
  });
});
