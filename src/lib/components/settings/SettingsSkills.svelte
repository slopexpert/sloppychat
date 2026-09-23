<script lang="ts">
	import { app } from '$lib/client/state.svelte';
	import { api } from '$lib/client/api';
	import Icon from '../Icon.svelte';

	let skillInput: HTMLInputElement | undefined = $state();
	/** Body text being typed, saved when the field is left or Save is pressed. */
	let skillDrafts = $state<Record<string, string>>({});

	async function uploadSkills(files: FileList | null | undefined) {
		if (!files?.length) return;
		try {
			const { skills } = await api.uploadSkills([...files]);
			await app.refreshSkills();
			app.toast('ok', skills.length === 1 ? `Added ${skills[0].name}` : `Added ${skills.length} skills`);
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
		}
	}

	/** A blank skill to type into, with a name that is not taken yet. */
	async function addBlankSkill() {
		const taken = new Set(app.skills.map((skill) => skill.name));
		let name = 'new-skill';
		for (let index = 2; taken.has(name); index++) name = `new-skill-${index}`;
		try {
			await api.createSkill({ name, description: '', body: '# Steps\n\n' });
			await app.refreshSkills();
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
		}
	}

	async function saveSkill(
		id: string,
		patch: Partial<{ name: string; description: string; body: string; enabled: boolean }>
	) {
		try {
			await api.updateSkill(id, patch);
			await app.refreshSkills();
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
		}
	}

	async function removeSkill(id: string) {
		try {
			await api.deleteSkill(id);
			await app.refreshSkills();
		} catch (err) {
			app.toast('error', err instanceof Error ? err.message : String(err));
		}
	}
</script>

<div class="space-y-3">
	<div class="card space-y-2 p-3">
		<div class="flex flex-wrap items-center gap-2">
			<h3 class="flex-1 text-sm font-semibold">Skills</h3>
			<button class="btn text-xs" onclick={() => skillInput?.click()}>
				<Icon name="plus" size={14} />
				Upload markdown
			</button>
			<button class="btn text-xs" onclick={addBlankSkill}>
				<Icon name="plus" size={14} />
				New skill
			</button>
			<input
				bind:this={skillInput}
				type="file"
				accept=".md,.markdown,text/markdown,text/plain"
				multiple
				class="hidden"
				onchange={(event) => {
					uploadSkills((event.currentTarget as HTMLInputElement).files);
					(event.currentTarget as HTMLInputElement).value = '';
				}}
			/>
		</div>
	</div>

	{#each app.skills as skill (skill.id)}
		<div class="card space-y-2 p-3">
			<div class="flex flex-wrap items-center gap-2">
				<input
					class="field w-44 text-xs"
					aria-label="Skill name"
					value={skill.name}
					onchange={(event) =>
						saveSkill(skill.id, { name: (event.currentTarget as HTMLInputElement).value })}
				/>
				<input
					class="field min-w-56 flex-1 text-xs"
					aria-label="Skill description"
					placeholder="When should the model use this skill?"
					value={skill.description}
					onchange={(event) =>
						saveSkill(skill.id, {
							description: (event.currentTarget as HTMLInputElement).value
						})}
				/>
				<label class="flex items-center gap-1.5 text-xs text-muted">
					<input
						type="checkbox"
						class="accent-[var(--accent)]"
						checked={skill.enabled}
						onchange={(event) =>
							saveSkill(skill.id, {
								enabled: (event.currentTarget as HTMLInputElement).checked
							})}
					/>
					enabled
				</label>
				<button
					class="icon-btn hover:text-danger"
					title="Delete this skill"
					aria-label="Delete this skill"
					onclick={() => removeSkill(skill.id)}
				>
					<Icon name="trash" />
				</button>
			</div>
			<textarea
				class="field min-h-40 font-mono text-xs"
				aria-label="Skill markdown, {skill.name}"
				value={skillDrafts[skill.id] ?? skill.body}
				oninput={(event) =>
					(skillDrafts = {
						...skillDrafts,
						[skill.id]: (event.currentTarget as HTMLTextAreaElement).value
					})}
			></textarea>
			<div class="flex justify-end gap-2">
				<button
					class="btn-accent text-xs"
					onclick={() => saveSkill(skill.id, { body: skillDrafts[skill.id] ?? skill.body })}
				>
					Save
				</button>
			</div>
		</div>
	{/each}

	{#if !app.skills.length}
		<p class="text-xs text-faint">No skills yet. Upload a markdown file to add one.</p>
	{/if}
</div>
