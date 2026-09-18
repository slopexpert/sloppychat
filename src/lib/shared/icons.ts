/**
 * Inline SVG icon set, drawn as simple geometry so no icon package is needed.
 * Every entry is the inner markup of a 24x24 stroke icon that uses currentColor.
 */

export const ICONS = {
	plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
	x: '<path d="M6 6l12 12"/><path d="M18 6L6 18"/>',
	check: '<path d="M4 12.5l5 5L20 6.5"/>',
	help: '<path d="M9.4 9.3a2.7 2.7 0 1 1 3.7 2.5c-.8.4-1.1.9-1.1 1.8v.3"/><path d="M12 17.2h.01"/>',
	send: '<path d="M12 20V5"/><path d="M6 11l6-6 6 6"/>',
	stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2"/>',
	refresh:
		'<path d="M4 12a8 8 0 0 1 13.7-5.6L20 8.5"/><path d="M20 4v4.5h-4.5"/><path d="M20 12a8 8 0 0 1-13.7 5.6L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
	settings:
		'<path d="M9.82 2.55L14.18 2.55L14.02 5.4L17.05 7.29L19.09 5.38L21.28 9.16L18.72 10.45L18.6 14.02L21.28 14.84L19.09 18.62L16.71 17.05L13.55 18.72L14.18 21.45L9.82 21.45L9.98 18.6L6.95 16.71L4.91 18.62L2.72 14.84L5.28 13.55L5.4 9.98L2.72 9.16L4.91 5.38L7.29 6.95L10.45 5.28Z"/>'
		+ '<circle cx="12" cy="12" r="2.8"/>',
	sliders:
		'<path d="M4 8h10"/><path d="M18 8h2"/><circle cx="16" cy="8" r="2"/><path d="M4 16h3"/><path d="M11 16h9"/><circle cx="9" cy="16" r="2"/>',
	chevronDown: '<path d="M6 9.5l6 6 6-6"/>',
	chevronRight: '<path d="M9.5 6l6 6-6 6"/>',
	chevronsLeft: '<path d="M12 6l-6 6 6 6"/><path d="M18 6l-6 6 6 6"/>',
	chevronsRight: '<path d="M6 6l6 6-6 6"/><path d="M12 6l6 6-6 6"/>',
	pencil: '<path d="M4 20l4-1 10-10a2.1 2.1 0 0 0-3-3L5 16l-1 4z"/><path d="M14 7l3 3"/>',
	trash:
		'<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="M6 7l1 13h10l1-13"/><path d="M10 11v6"/><path d="M14 11v6"/>',
	copy:
		'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 6H6a2 2 0 0 0-2 2v9"/>',
	search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20"/>',
	globe:
		'<circle cx="12" cy="12" r="8"/><path d="M4 12h16"/><path d="M12 4c2.5 2.5 2.5 13 0 16"/><path d="M12 4c-2.5 2.5-2.5 13 0 16"/>',
	wrench:
		'<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
	clock: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 1.9"/>',
	book: '<path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z"/>',
	fileText:
		'<path d="M13 3.5H7.5A1.5 1.5 0 0 0 6 5v14a1.5 1.5 0 0 0 1.5 1.5h9A1.5 1.5 0 0 0 18 19V8.5z"/><path d="M13 3.5V8.5H18"/><path d="M9 12.5h6"/><path d="M9 16h4"/>',
	messageSquare: '<path d="M5 5h14v11H9l-4 3z"/>',
	loader: '<path d="M12 4v3.5"/><path d="M12 16.5V20"/><path d="M4.9 8.5l3 1.8"/><path d="M16.1 13.7l3 1.8"/><path d="M4.9 15.5l3-1.8"/><path d="M16.1 10.3l3-1.8"/>',
	paperclip:
		'<path d="M18 10.5l-6.5 6.5a3.5 3.5 0 0 1-5-5L13 5.5a2.5 2.5 0 0 1 3.5 3.5L10 15.5a1.5 1.5 0 0 1-2-2l6-6"/>',
	sparkles: '<path d="M12 4l1.6 4.4L18 10l-4.4 1.6L12 16l-1.6-4.4L6 10l4.4-1.6z"/><path d="M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"/>',
	gauge: '<path d="M5 17a8 8 0 1 1 14 0"/><path d="M12 13l3.5-3.5"/><circle cx="12" cy="13" r="1.4"/>',
	alert: '<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4"/><path d="M12 17h.01"/>',
	key: '<circle cx="8.5" cy="15.5" r="3.5"/><path d="M11 13l7-7"/><path d="M15.5 8.5l2 2"/><path d="M17.5 6.5l2 2"/>',
} as const;

export type IconName = keyof typeof ICONS;
