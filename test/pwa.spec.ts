import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The installable app: the manifest and its icons, the head that links them, and
 * what the service worker is allowed to keep.
 */

interface IconEntry {
	src: string;
	sizes: string;
	type: string;
	purpose?: string;
}

const manifest = JSON.parse(readFileSync('static/manifest.webmanifest', 'utf8')) as {
	name: string;
	short_name: string;
	description: string;
	start_url: string;
	scope: string;
	display: string;
	background_color: string;
	theme_color: string;
	icons: IconEntry[];
};

/** The size in the header of a PNG, which is what a launcher reads. */
function pngSize(file: string): { width: number; height: number } {
	const bytes = readFileSync(file);
	expect(bytes.subarray(1, 4).toString('ascii'), `${file} is a PNG`).toBe('PNG');
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

describe('the manifest', () => {
	it('names the app and opens the chat list', () => {
		expect(manifest.name).toBe('sloppychat');
		expect(manifest.short_name).toBe('sloppychat');
		expect(manifest.start_url).toBe('/');
		expect(manifest.display).toBe('standalone');
		expect(manifest.theme_color).toBeTruthy();
		expect(manifest.background_color).toBeTruthy();
	});

	it('points at icons that are there, at the sizes it claims', () => {
		for (const size of [192, 512]) {
			const icon = manifest.icons.find(
				(item) => item.sizes === `${size}x${size}` && item.type === 'image/png' && item.purpose !== 'maskable'
			);
			expect(icon, `an icon of ${size} pixels`).toBeTruthy();
			const file = `static${icon!.src}`;
			expect(existsSync(file), file).toBe(true);
			expect(pngSize(file)).toEqual({ width: size, height: size });
		}
	});

	it('carries a maskable icon, which a launcher may crop', () => {
		const maskable = manifest.icons.find((item) => item.purpose === 'maskable');
		expect(maskable).toBeTruthy();
		expect(pngSize(`static${maskable!.src}`)).toEqual({ width: 512, height: 512 });
	});

	it('is linked from the head, with the theme colour and the iOS pieces', () => {
		const html = readFileSync('src/app.html', 'utf8');
		expect(html).toContain('rel="manifest"');
		expect(html).toContain('name="theme-color"');
		expect(html).toContain('apple-touch-icon');
		expect(html).toContain('apple-mobile-web-app-title');
	});
});

describe('the service worker', () => {
	const worker = readFileSync('src/lib/server/sw-worker.js', 'utf8');

	it('never caches the API, which the stream and the turns need', () => {
		// A request to the API passes straight through.
		expect(worker).toMatch(/pathname\.startsWith\('\/api\/'\)\s*\)\s*return/);
		// And the shell list holds no API path.
		const listed = /SHELL_FILES = \[([\s\S]*?)\]/.exec(worker)?.[1] ?? '';
		const entries = [...listed.matchAll(/'([^']+)'/g)].map((match) => match[1]);
		expect(entries.length).toBeGreaterThan(3);
		expect(entries.filter((entry) => entry.startsWith('/api/'))).toEqual([]);
		expect(entries).toContain('/');
	});

	it('takes a page from the network first, and has something for offline', () => {
		expect(worker).toContain("mode === 'navigate'");
		expect(worker).toMatch(/fetch\(event\.request\)/);
		expect(worker).toContain("caches.match('/offline.html')");
		expect(existsSync('static/offline.html')).toBe(true);
	});

	it('keeps the built assets, whose names carry a hash', () => {
		expect(worker).toContain("startsWith('/_app/immutable/')");
	});

	it('is served from a route that forbids caching', () => {
		// A cached worker would hide a new shell from the browser.
		const route = readFileSync('src/routes/sw.js/+server.ts', 'utf8');
		expect(route).toContain("'cache-control': 'no-cache'");
		expect(route).toContain("'content-type': 'text/javascript'");
	});

	it('drops the caches of older versions, and has a version to bump', () => {
		expect(worker).toMatch(/const VERSION = '/);
		expect(worker).toMatch(/caches\s*\.\s*keys\(\)/);
		expect(worker).toMatch(/caches\.delete\(key\)/);
	});
});
