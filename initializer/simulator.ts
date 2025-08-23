import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { type ActionSpace, type UniverseState, canonicalEventSchema, type CanonicalEvent } from './interfaces';

// Simple timeout helper
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new Error(`LLM timeout after ${ms}ms`)), ms);
    });
    try {
        return await Promise.race([p, timeoutPromise]);
    } finally {
        // @ts-ignore
        clearTimeout(timeoutHandle);
    }
}

type Agent = UniverseState['agents'][number];

class UniverseSimulator {
    private events: CanonicalEvent[] = [];
    private currentTime: Date;
    private spaceMembers: Map<string, Set<string>> = new Map();

    constructor(
        private universe: UniverseState,
        private actionSpace: ActionSpace,
        private startTime: Date = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) // Week ago
    ) {
        this.currentTime = startTime;
        this.initializeMemberships();
    }

    private initializeMemberships() {
        for (const membership of this.universe.memberships) {
            if (!this.spaceMembers.has(membership.spaceId)) {
                this.spaceMembers.set(membership.spaceId, new Set());
            }
            this.spaceMembers.get(membership.spaceId)!.add(membership.agentId);
        }
    }

    async simulate(numEvents: number): Promise<CanonicalEvent[]> {
        for (let i = 0; i < numEvents; i++) {
            console.log(`→ turn ${i + 1}/${numEvents}`);
            try {
                const event = await this.simulateNextEvent();
                this.events.push(event);
                console.log(`  ✓ ${event.action} by ${event.actorId} in ${event.contextId ?? 'global'} (vis=${event.visibility.length})`);
            } catch (err: any) {
                console.error(`  ✗ turn ${i + 1} failed: ${err?.message || err}`);
                // Continue to next turn
            }
            // Apply side effects based on action type
            const lastEvent = this.events[this.events.length - 1];
            if (lastEvent) {
                if (this.isContextCreatingAction(lastEvent)) {
                    this.handleContextCreation(lastEvent);
                }
                if (this.isMembershipAction(lastEvent)) {
                    this.handleMembershipChange(lastEvent);
                }
            }
            this.advanceTime();
        }
        return this.events;
    }

    private async simulateNextEvent(): Promise<CanonicalEvent> {
        const actor = this.selectActor();
        const context = this.buildContext(actor.id);

        // Allowed contexts for the actor
        let allowedContextIds = Array.from(this.spaceMembers.entries())
            .filter(([_, members]) => members.has(actor.id))
            .map(([spaceId]) => spaceId);
        if (allowedContextIds.length === 0) allowedContextIds = this.universe.initialSpaces.map(s => s.id);

        // Dynamic schema: action with required parameters
        const turnSchema = z.object({
            action: z.enum(this.actionSpace.actions.map(a => a.name) as [string, ...string[]]),
            parameters: z.record(z.string()).describe('Required parameters for the chosen action (including message text in the "message" parameter if needed)')
        });

        const contextsDetail = allowedContextIds.map(id => {
            const s = this.universe.initialSpaces.find(sp => sp.id === id);
            return { id, name: (s?.data as any)?.name ?? id, type: s?.type ?? 'Context' };
        });

        let obj: z.infer<typeof turnSchema>;
        try {
            // Inject available actions into the agent's prompt
            const enhancedSystemPrompt = `${actor.systemPrompt}

AVAILABLE ACTIONS (use exactly these names):
${this.actionSpace.actions.map(a => `- ${a.name}: ${a.description}`).join('\n')}`;

            const gen = generateObject({
                model: openai('gpt-5-mini'),
                system: enhancedSystemPrompt,
                prompt: `${context}

Your spaces (choose based on topic/audience):
${allowedContextIds.map(id => {
                    const space = this.universe.initialSpaces.find(s => s.id === id);
                    const memberCount = this.spaceMembers.get(id)?.size || 0;
                    return `- ${(space?.data as any)?.name || id} (${space?.type}, ${memberCount} members)`;
                }).join('\n')}

Rules:
- First decide WHAT you want to communicate based on your role and goals
- Don't always post to the most active space - distribute conversations naturally
- Provide all required parameters for your chosen action
- Use actual IDs from the contexts you belong to
- Choose actions that are supported in your target space
- Put message text in the "message" parameter (not a separate content field)

Available actions and their required parameters:
${this.actionSpace.actions.map(a => `- ${a.name}: ${JSON.stringify(a.requiredParams)}`).join('\n')}

Your accessible spaces and what actions they support:
${allowedContextIds.map(id => {
                    const space = this.universe.initialSpaces.find(s => s.id === id);
                    const spaceType = this.actionSpace.spaceTypes.find(st => st.name === space?.type);
                    const supportedActions = spaceType?.supportsActions || [];
                    return `- ${id} (${space?.type}): ${(space?.data as any)?.name || id}
    Supports: ${supportedActions.join(', ')}`;
                }).join('\n')}

Your ID: ${actor.id}
`,
                schema: turnSchema,
                temperature: 0.7,
            });
            const res = await withTimeout(gen as any, 45000);
            obj = (res as any).object as z.infer<typeof turnSchema>;
            console.log(`  DEBUG: LLM returned:`, JSON.stringify(obj));
        } catch (err) {
            console.error(`  ERROR: LLM failed:`, err);
            throw err; // No fallback - let it fail
        }

        // Infer contextId, recipients, parentId from action definition and memberships
        const def = this.actionSpace.actions.find(a => a.name === obj.action);
        if (!def) {
            console.error(`  ERROR: Action "${obj.action}" not found in action space. Available: ${this.actionSpace.actions.map(a => a.name).join(', ')}`);
            throw new Error(`Invalid action "${obj.action}" - not in action space`);
        }

        // Check what this action requires
        const requiresParent = (def?.requiredParams ?? []).includes('parent_id');

        // Infer context from parameters using spaceParameter
        let chosenContext: string | undefined;
        const needsContext = def?.visibilityComputation?.method === 'space_members' ||
            requiresParent || // Need context to find parent
            def?.canCreateSpace; // Need context for space creation

        if (needsContext && def.spaceParameter) {
            // Get context from the parameter that represents the space
            const inferredContext = obj.parameters[def.spaceParameter];
            console.log(`  DEBUG: Need context for ${obj.action}. Inferred from ${def.spaceParameter}="${inferredContext}", allowed: ${allowedContextIds.join(', ')}`);

            if (inferredContext && allowedContextIds.includes(inferredContext)) {
                chosenContext = inferredContext;
                console.log(`  DEBUG: Using inferred context: ${chosenContext}`);
            } else {
                console.error(`  ERROR: Inferred context "${inferredContext}" not in allowed list`);
                throw new Error(`Invalid context "${inferredContext}" - must be one of: ${allowedContextIds.join(', ')}`);
            }
            // Validate support
            if (chosenContext) {
                const type = this.universe.initialSpaces.find(s => s.id === chosenContext)?.type;
                const supports = this.actionSpace.spaceTypes.find(t => t.name === type)?.supportsActions ?? [];
                if (!supports.includes(obj.action)) {
                    // No fallbacks - the agent chose wrong, let it fail
                    console.error(`  ERROR: Context ${chosenContext} (type=${type}) doesn't support action ${obj.action}`);
                    console.error(`  ERROR: Supported actions for ${type}: ${supports.join(', ')}`);
                    throw new Error(`Action ${obj.action} not supported in context ${chosenContext} - agent made invalid choice`);
                }
            }
        }

        // If this is a reply action (parent_id required), bind to the latest visible event in that context
        let parentId: string | undefined;
        if (requiresParent) {
            parentId = this.pickLatestVisibleEventId(actor.id, chosenContext);
        }

        // If recipients-based visibility, pick recipients from peers (members in chosen context if any, else global minus actor)
        let recipients: string[] | undefined;
        const recipMethod = def?.visibilityComputation?.method === 'explicit_recipients';
        if (recipMethod) {
            const pool = chosenContext
                ? Array.from(this.spaceMembers.get(chosenContext) ?? [])
                : this.universe.agents.map(a => a.id);
            recipients = pool.filter(id => id !== actor.id).slice(0, 2);
            if (recipients.length === 0) recipients = undefined;
        }

        // Extract message content from parameters if present
        const messageContent = obj.parameters.message || obj.parameters.text || obj.parameters.content;

        // Compute visibility
        const visibility = this.inferVisibility({
            action: obj.action,
            actorId: actor.id,
            contextId: chosenContext,
            recipients,
            parentId,
            content: messageContent,
            metadata: obj.parameters  // Pass the actual parameters
        });

        return {
            id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(this.currentTime),
            action: obj.action,
            actorId: actor.id,
            contextId: chosenContext,
            recipients,
            parentId,
            content: messageContent,
            metadata: obj.parameters,  // Pass the actual parameters
            visibility
        };
    }

    private inferVisibility(ev: Omit<CanonicalEvent, 'id' | 'timestamp' | 'visibility'>): string[] {
        const def = this.actionSpace.actions.find(a => a.name === ev.action);
        const method = def?.visibilityComputation?.method;

        console.log(`  DEBUG: Computing visibility for ${ev.action} (method=${method}, contextId=${ev.contextId})`);

        if (method === 'space_members' && ev.contextId) {
            const members = this.spaceMembers.get(ev.contextId);
            console.log(`  DEBUG: Space members for ${ev.contextId}: ${members ? Array.from(members).join(', ') : 'NOT FOUND'}`);
            return members ? Array.from(members) : [ev.actorId];
        }
        if (method === 'explicit_recipients' && ev.recipients?.length) {
            return Array.from(new Set([ev.actorId, ...ev.recipients]));
        }
        if (method === 'everyone') {
            return this.universe.agents.map(a => a.id);
        }
        // No fallbacks - fail if we can't determine visibility
        console.error(`  ERROR: Could not determine visibility for action ${ev.action} with method ${method}`);
        throw new Error(`Unable to compute visibility for ${ev.action}`);
    }

    private isContextCreatingAction(ev: CanonicalEvent): boolean {
        const action = this.actionSpace.actions.find(a => a.name === ev.action);
        return action?.canCreateSpace || false;
    }

    private isMembershipAction(ev: CanonicalEvent): boolean {
        const action = this.actionSpace.actions.find(a => a.name === ev.action);
        return action?.createsEntity === 'members';
    }

    private handleMembershipChange(ev: CanonicalEvent) {
        console.log(`  DEBUG: Handling membership change for ${ev.action}`);
        const action = this.actionSpace.actions.find(a => a.name === ev.action);

        if (action?.createsEntity === 'members' && action.spaceParameter && ev.metadata) {
            // Get the space ID from the parameter specified by spaceParameter
            const spaceId = ev.metadata[action.spaceParameter];
            // Find user parameter (common patterns: user_id, agent_id, member_id)
            const userId = ev.metadata.user_id || ev.metadata.agent_id || ev.metadata.member_id;

            if (spaceId && userId) {
                // Initialize the space if it doesn't exist
                if (!this.spaceMembers.has(spaceId)) {
                    console.log(`  DEBUG: Initializing members set for ${spaceId}`);
                    this.spaceMembers.set(spaceId, new Set());
                }

                // Add the member
                this.spaceMembers.get(spaceId)!.add(userId);

                // Also update universe memberships
                const existing = this.universe.memberships.find(
                    m => m.agentId === userId && m.spaceId === spaceId
                );
                if (!existing) {
                    this.universe.memberships.push({ agentId: userId, spaceId });
                }

                console.log(`  DEBUG: Added ${userId} to ${spaceId}. Members now: ${Array.from(this.spaceMembers.get(spaceId)!).join(', ')}`);
            } else {
                console.log(`  DEBUG: Missing spaceId (${spaceId}) or userId (${userId}) for membership change`);
            }
        }
    }

    private handleContextCreation(ev: CanonicalEvent) {
        const spaceId = `space_${Date.now()}`;
        const members = new Set<string>([ev.actorId, ...(ev.recipients ?? [])]);
        this.spaceMembers.set(spaceId, members);

        const supportedType = this.actionSpace.spaceTypes.find(st => st.supportsActions.includes(ev.action))?.name;
        const type = supportedType ?? 'Context';

        this.universe.initialSpaces.push({
            id: spaceId,
            type,
            data: { name: ev.metadata?.name || 'new-context' }
        });
        for (const uid of members) this.universe.memberships.push({ agentId: uid, spaceId });
    }

    private selectActor(): Agent {
        const weights = this.universe.agents.map(a => a.activityLevel);
        const total = weights.reduce((a, b) => a + b, 0) || 1;
        let r = Math.random() * total;
        for (let i = 0; i < this.universe.agents.length; i++) {
            r -= weights[i];
            if (r <= 0) return this.universe.agents[i];
        }
        return this.universe.agents[0];
    }

    private buildContext(actorId: string): string {
        // Show more history to prevent repetition
        const visible = this.events.filter(e => e.visibility.includes(actorId)).slice(-50);
        console.log(`  DEBUG: Building context for ${actorId}. Found ${visible.length} visible events out of ${this.events.length} total`);

        const byCtx = new Map<string, CanonicalEvent[]>();
        const globalEvents: CanonicalEvent[] = [];

        for (const e of visible) {
            if (!e.contextId) {
                // Separate global/system events
                globalEvents.push(e);
            } else {
                const key = e.contextId;
                if (!byCtx.has(key)) byCtx.set(key, []);
                byCtx.get(key)!.push(e);
            }
        }

        console.log(`  DEBUG: Events by context:`, Array.from(byCtx.entries()).map(([ctx, evs]) => `${ctx}:${evs.length}`).join(', '), `global:${globalEvents.length}`);

        let s = "Recent activity you can see:\n\n";

        // Show global/system events first
        if (globalEvents.length > 0) {
            s += `System/Global events:\n`;
            for (const e of globalEvents.slice(-5)) {
                const who = this.universe.agents.find(a => a.id === e.actorId)?.name ?? e.actorId;
                s += `- ${who}: ${e.action}${e.content ? ` (${e.content})` : ''}\n`;
            }
            s += "\n";
        }

        // Show channel-specific events
        for (const [ctxId, evs] of byCtx) {
            const ctx = this.universe.initialSpaces.find(sp => sp.id === ctxId);
            const name = (ctx?.data as any)?.name ?? ctxId;
            s += `In ${name}:\n`;

            // Show all events from this context (already limited by the initial slice)
            for (const e of evs) {
                const who = this.universe.agents.find(a => a.id === e.actorId)?.name ?? e.actorId;
                const isMe = e.actorId === actorId ? ' (you)' : '';
                // Show enough content to preserve meaning
                const content = e.content ? e.content.substring(0, 250) + (e.content.length > 250 ? '...' : '') : e.action;
                s += `- ${who}${isMe}: ${content}\n`;
            }
            s += "\n";
        }
        const myCtx = Array.from(this.spaceMembers.entries())
            .filter(([_, m]) => m.has(actorId))
            .map(([id]) => (this.universe.initialSpaces.find(s => s.id === id)?.data as any)?.name ?? id);
        s += `\nYou are in these contexts: ${myCtx.join(', ')}\n`;

        console.log(`  DEBUG: Context preview for ${actorId}:`, s.substring(0, 200) + '...');
        return s;
    }

    private advanceTime() {
        const delta = this.calculateTimeJump();
        this.currentTime = new Date(this.currentTime.getTime() + delta);
    }

    private calculateTimeJump(): number {
        const hour = this.currentTime.getHours();
        if (hour >= 22 || hour < 7) return Math.random() * 8 * 60 * 60 * 1000;
        if (hour >= 9 && hour < 17) return Math.random() * 10 * 60 * 1000;
        return Math.random() * 60 * 60 * 1000;
    }

    private pickRecentContextForActor(actorId: string, allowed: string[]): string | undefined {
        // Scan recent events for contexts visible to actor, pick the most recent among allowed
        for (let i = this.events.length - 1; i >= 0; i--) {
            const e = this.events[i];
            if (e.visibility.includes(actorId) && e.contextId && allowed.includes(e.contextId)) {
                return e.contextId;
            }
        }
        return undefined;
    }

    private pickLatestVisibleEventId(actorId: string, contextId?: string): string | undefined {
        for (let i = this.events.length - 1; i >= 0; i--) {
            const e = this.events[i];
            if (e.visibility.includes(actorId) && (!contextId || e.contextId === contextId)) {
                return e.id;
            }
        }
        return undefined;
    }
}

export async function runSimulation(
    universe: UniverseState,
    actionSpace: ActionSpace,
    numEvents: number = 10
) {
    const simulator = new UniverseSimulator(universe, actionSpace);
    const events = await simulator.simulate(numEvents);
    console.log(`Generated ${events.length} events`);
    return events;
}

