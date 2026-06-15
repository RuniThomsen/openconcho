const THEME_KEY = "openconcho:theme";

export const THEMES = ["runi", "dark", "light"] as const;

export type Theme = (typeof THEMES)[number];

export function getStoredTheme(): Theme {
	const stored = localStorage.getItem(THEME_KEY) as Theme | null;
	if (stored && THEMES.includes(stored)) return stored;
	return "runi";
}

export function applyTheme(theme: Theme): void {
	document.documentElement.setAttribute("data-theme", theme);
	localStorage.setItem(THEME_KEY, theme);
}

export function nextTheme(theme: Theme): Theme {
	const index = THEMES.indexOf(theme);
	return THEMES[(index + 1) % THEMES.length];
}

export function themeLabel(theme: Theme): string {
	if (theme === "runi") return "Runi";
	if (theme === "dark") return "Dark";
	return "Light";
}
