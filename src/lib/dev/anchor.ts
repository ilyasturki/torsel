const INTENT = ['pointerdown', 'wheel', 'touchstart', 'keydown'] as const;

export function holdAnchor(): () => void {
	const id = decodeURIComponent(location.hash.slice(1));
	if (id === '') return () => {};

	const land = (): void => document.getElementById(id)?.scrollIntoView({ block: 'start' });
	const observer = new ResizeObserver(land);
	observer.observe(document.body);

	const release = (): void => {
		observer.disconnect();
		for (const type of INTENT) removeEventListener(type, release, true);
		removeEventListener('hashchange', release);
	};
	for (const type of INTENT) addEventListener(type, release, { capture: true, passive: true });
	addEventListener('hashchange', release);
	return release;
}
