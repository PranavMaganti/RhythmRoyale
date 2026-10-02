import { expect, test } from "vitest";
import { sanitizeName } from "./names.js";

test("sanitizeName trims, strips markup and falls back to a default", () => {
  expect(sanitizeName("  Ann  ")).toBe("Ann");
  expect(sanitizeName("<script>x</script>")).toBe("scriptxscript");
  expect(sanitizeName("Zoë_99")).toBe("Zoë_99");
  expect(sanitizeName("a".repeat(40))).toHaveLength(16);
  expect(sanitizeName("")).toBe("Player");
  expect(sanitizeName(undefined)).toBe("Player");
});
