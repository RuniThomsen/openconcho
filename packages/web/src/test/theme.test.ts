import { describe, expect, it } from "vitest";
import { applyTheme, getStoredTheme, nextTheme, themeLabel } from "@/lib/theme";

describe("theme", () => {
	it("defaults to the Runi theme", () => {
		expect(getStoredTheme()).toBe("runi");
	});

	it("persists the selected theme on the root element", () => {
		applyTheme("runi");
		expect(document.documentElement.getAttribute("data-theme")).toBe("runi");
		expect(localStorage.getItem("openconcho:theme")).toBe("runi");
	});

	it("cycles through Runi, dark, and light", () => {
		expect(nextTheme("runi")).toBe("dark");
		expect(nextTheme("dark")).toBe("light");
		expect(nextTheme("light")).toBe("runi");
	});

	it("provides readable labels for theme controls", () => {
		expect(themeLabel("runi")).toBe("Runi");
		expect(themeLabel("dark")).toBe("Dark");
		expect(themeLabel("light")).toBe("Light");
	});
});
