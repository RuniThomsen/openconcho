import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

const memoryStorage = (() => {
	const store = new Map<string, string>();
	return {
		get length() {
			return store.size;
		},
		clear: () => store.clear(),
		getItem: (key: string) => store.get(key) ?? null,
		key: (index: number) => Array.from(store.keys())[index] ?? null,
		removeItem: (key: string) => store.delete(key),
		setItem: (key: string, value: string) => store.set(key, String(value)),
	} satisfies Storage;
})();

Object.defineProperty(globalThis, "localStorage", {
	configurable: true,
	value: window.localStorage ?? memoryStorage,
});

// jsdom defines scrollTo but leaves it unimplemented; router scroll restoration calls it.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

if (!window.matchMedia) {
	window.matchMedia = vi.fn().mockImplementation((query: string) => ({
		matches: false,
		media: query,
		onchange: null,
		addListener: vi.fn(),
		removeListener: vi.fn(),
		addEventListener: vi.fn(),
		removeEventListener: vi.fn(),
		dispatchEvent: vi.fn(),
	}));
}

afterEach(() => {
	cleanup();
	localStorage.clear();
});
