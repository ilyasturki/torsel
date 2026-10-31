<script lang="ts">
	const LENGTH = 6;

	let {
		value = $bindable(''),
		disabled = false,
		oncomplete
	}: { value?: string; disabled?: boolean; oncomplete?: () => void } = $props();

	const blank = (): string[] => Array.from({ length: LENGTH }, () => '');

	let digits = $state(blank());
	const boxes: HTMLInputElement[] = $state([]);

	function focusAt(index: number): void {
		boxes[index]?.focus();
		boxes[index]?.select();
	}

	function publish(): void {
		value = digits.join('');
		if (digits.every((digit) => digit !== '')) {
			oncomplete?.();
		}
	}

	function spread(chars: string[]): void {
		digits = Array.from({ length: LENGTH }, (_, index) => chars[index] ?? '');
		focusAt(Math.min(chars.length, LENGTH - 1));
		publish();
	}

	function onInput(index: number, event: Event & { currentTarget: HTMLInputElement }): void {
		const typed = event.currentTarget.value.replace(/\D/gu, '');
		// A tap collapses the select-on-focus on a phone, so typing into a filled box arrives as two digits.
		const raw =
			typed.length === 2 && digits[index] !== ''
				? typed.replace(digits[index], '') || digits[index]
				: typed;

		// Autofill hands a one-time code to the first box as one input event, not a paste.
		if (raw.length > 1) {
			spread(raw.slice(0, LENGTH).split(''));
			return;
		}

		digits[index] = raw;
		event.currentTarget.value = raw;
		if (raw !== '' && index < LENGTH - 1) {
			focusAt(index + 1);
		}
		publish();
	}

	function onKeydown(index: number, event: KeyboardEvent): void {
		if (event.key === 'Backspace') {
			event.preventDefault();
			if (digits[index] !== '') {
				digits[index] = '';
			} else if (index > 0) {
				digits[index - 1] = '';
				focusAt(index - 1);
			}
			value = digits.join('');
		} else if (event.key === 'ArrowLeft' && index > 0) {
			event.preventDefault();
			focusAt(index - 1);
		} else if (event.key === 'ArrowRight' && index < LENGTH - 1) {
			event.preventDefault();
			focusAt(index + 1);
		}
	}

	function onPaste(event: ClipboardEvent): void {
		const chars = (event.clipboardData?.getData('text') ?? '')
			.replace(/\D/gu, '')
			.slice(0, LENGTH)
			.split('');

		if (chars.length > 0) {
			event.preventDefault();
			spread(chars);
		}
	}

	$effect(() => {
		if (value === '' && !disabled) {
			digits = blank();
			focusAt(0);
		}
	});
</script>

<div class="flex justify-between gap-2" role="group" aria-label="Sign-in code">
	{#each digits as digit, index (index)}
		<input
			bind:this={boxes[index]}
			class="h-cta w-full min-w-0 rounded-box bg-tint text-center font-mono text-lg font-semibold text-ink transition-colors motion outline-none hover:bg-tint-2 focus:bg-tint-2"
			type="text"
			inputmode="numeric"
			autocomplete={index === 0 ? 'one-time-code' : 'off'}
			name={index === 0 ? 'code' : undefined}
			aria-label="Digit {index + 1} of {LENGTH}"
			value={digit}
			{disabled}
			oninput={(event) => onInput(index, event)}
			onkeydown={(event) => onKeydown(index, event)}
			onpaste={onPaste}
			onfocus={(event) => event.currentTarget.select()}
		/>
	{/each}
</div>
