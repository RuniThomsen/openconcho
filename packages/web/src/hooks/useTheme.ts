import { useEffect, useState } from "react";
import { applyTheme, getStoredTheme, nextTheme, type Theme } from "@/lib/theme";

export function useTheme() {
	const [theme, setTheme] = useState<Theme>(() => getStoredTheme());

	useEffect(() => {
		applyTheme(theme);
	}, [theme]);

	function toggle() {
		setTheme((t) => nextTheme(t));
	}

	return { theme, toggle };
}
