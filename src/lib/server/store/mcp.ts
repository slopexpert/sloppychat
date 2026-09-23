/** The saved MCP servers. Their config, which holds secrets, stays on the server. */

import { all, one, run, newId, now } from '../db';
import { str, json, type Row } from './rows';
import { type McpServer, type McpServerConfig } from '$lib/shared/types';

function mapMcpServer(row: Row): McpServer {
	return {
		id: str(row.id),
		name: str(row.name, 'server'),
		enabled: row.enabled === 1,
		config: json<McpServerConfig>(row.config, { transport: 'stdio' }),
		createdAt: str(row.created_at),
		updatedAt: str(row.updated_at)
	};
}

export function listMcpServers(): McpServer[] {
	return all('SELECT * FROM mcp_servers ORDER BY name COLLATE NOCASE').map(mapMcpServer);
}

export function getMcpServer(id: string): McpServer | undefined {
	const row = one('SELECT * FROM mcp_servers WHERE id = ?', id);
	return row ? mapMcpServer(row) : undefined;
}

export function createMcpServer(input: { name: string; config: McpServerConfig; enabled?: boolean }): McpServer {
	const id = newId();
	const stamp = now();
	run(
		'INSERT INTO mcp_servers (id, name, enabled, config, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
		id,
		input.name,
		input.enabled === false ? 0 : 1,
		JSON.stringify(input.config),
		stamp,
		stamp
	);
	return getMcpServer(id)!;
}

export function updateMcpServer(
	id: string,
	patch: { name?: string; enabled?: boolean; config?: McpServerConfig }
): McpServer | undefined {
	const current = getMcpServer(id);
	if (!current) return undefined;
	run(
		'UPDATE mcp_servers SET name = ?, enabled = ?, config = ?, updated_at = ? WHERE id = ?',
		patch.name ?? current.name,
		(patch.enabled ?? current.enabled) ? 1 : 0,
		JSON.stringify(patch.config ?? current.config),
		now(),
		id
	);
	return getMcpServer(id);
}

export function deleteMcpServer(id: string): void {
	run('DELETE FROM mcp_servers WHERE id = ?', id);
}
