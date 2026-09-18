<script lang="ts">
	import { ICONS, type IconName } from '$lib/shared/icons';

	/**
	 * Stroke icon that inherits the current text colour, so buttons style it for
	 * free. The inner markup is a trusted constant from icons.ts.
	 */

	let {
		name,
		size = 16,
		stroke = 1.75,
		spin = false,
		class: className = ''
	}: {
		name: IconName;
		size?: number;
		stroke?: number;
		spin?: boolean;
		class?: string;
	} = $props();
</script>

<svg
	viewBox="0 0 24 24"
	width={size}
	height={size}
	fill="none"
	stroke="currentColor"
	stroke-width={stroke}
	stroke-linecap="round"
	stroke-linejoin="round"
	class="{(className ? `${className} ` : '') + (spin ? 'animate-spin ' : '')}shrink-0"
	aria-hidden="true"
	focusable="false"
>
	{@html ICONS[name]}
</svg>
