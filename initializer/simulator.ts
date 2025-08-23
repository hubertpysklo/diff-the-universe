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
            if (this.isContextCreatingAction(this.events[this.events.length - 1]!)) {
                this.handleContextCreation(this.events[this.events.length - 1]!);
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

        // Dynamic schema: minimal intent only
        const turnSchema = z.object({
            action: z.enum(this.actionSpace.actions.map(a => a.name) as [string, ...string[]]),
            content: z.string().optional()
        });

        const contextsDetail = allowedContextIds.map(id => {
            const s = this.universe.initialSpaces.find(sp => sp.id === id);
            return { id, name: (s?.data as any)?.name ?? id, type: s?.type ?? 'Context' };
        });

        let obj: z.infer<typeof turnSchema>;
        try {
            const gen = generateObject({
                model: openai('gpt-5-mini'),
                system: actor.systemPrompt,
                prompt: `${context}

Rules:
- Pick an action fitting the intent based on recent activity
- Do not emit IDs or recipients; the system will infer where and who sees it from memberships
- If replying, keep it concise and coherent with the recent context

Available contexts you belong to (for your awareness):
${JSON.stringify(contextsDetail, null, 2)}
`,
                schema: turnSchema,
                temperature: 0.7,
            });
            const res = await withTimeout(gen as any, 30000);
            obj = (res as any).object as z.infer<typeof turnSchema>;
        } catch (err) {
            // Graceful fallback: pick a conversational action with 'message' if available
            const conversational = this.actionSpace.actions.find(a => (a.requiredParams ?? []).includes('message'))?.name
                ?? this.actionSpace.actions[0]?.name
                ?? 'post_message';
            obj = { action: conversational, content: '...' } as any;
            console.warn(`  ! fallback action used due to error: ${(err as any)?.message || err}`);
        }

        // Infer contextId, recipients, parentId from action definition and memberships
        const def = this.actionSpace.actions.find(a => a.name === obj.action);

        // Choose context for space-based actions
        let chosenContext: string | undefined;
        const needsContext = def?.visibilityComputation?.method === 'space_members';
        if (needsContext) {
            // Prefer most recent visible context the actor belongs to; else first allowed
            const recentCtx = this.pickRecentContextForActor(actor.id, allowedContextIds);
            chosenContext = recentCtx ?? allowedContextIds[0];
            // Validate support
            if (chosenContext) {
                const type = this.universe.initialSpaces.find(s => s.id === chosenContext)?.type;
                const supports = this.actionSpace.spaceTypes.find(t => t.name === type)?.supportsActions ?? [];
                if (!supports.includes(obj.action)) {
                    const firstSupported = allowedContextIds.find(id => {
                        const t = this.universe.initialSpaces.find(s => s.id === id)?.type;
                        const sp = this.actionSpace.spaceTypes.find(tt => tt.name === t)?.supportsActions ?? [];
                        return sp.includes(obj.action);
                    });
                    chosenContext = firstSupported ?? chosenContext;
                }
            }
        }

        // If this is a reply action (parent_id required), bind to the latest visible event in that context
        let parentId: string | undefined;
        const requiresParent = (def?.requiredParams ?? []).includes('parent_id');
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

        // Compute visibility
        const visibility = this.inferVisibility({
            action: obj.action,
            actorId: actor.id,
            contextId: chosenContext,
            recipients,
            parentId,
            content: obj.content,
            metadata: undefined
        });

        return {
            id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(this.currentTime),
            action: obj.action,
            actorId: actor.id,
            contextId: chosenContext,
            recipients,
            parentId,
            content: obj.content,
            metadata: undefined,
            visibility
        };
    }

    private inferVisibility(ev: Omit<CanonicalEvent, 'id' | 'timestamp' | 'visibility'>): string[] {
        const def = this.actionSpace.actions.find(a => a.name === ev.action);
        const method = def?.visibilityComputation?.method;

        if (method === 'space_members' && ev.contextId) {
            const members = this.spaceMembers.get(ev.contextId);
            return members ? Array.from(members) : [ev.actorId];
        }
        if (method === 'explicit_recipients' && ev.recipients?.length) {
            return Array.from(new Set([ev.actorId, ...ev.recipients]));
        }
        if (method === 'everyone') {
            return this.universe.agents.map(a => a.id);
        }
        // Fallbacks
        if (ev.contextId && this.spaceMembers.has(ev.contextId)) {
            return Array.from(this.spaceMembers.get(ev.contextId)!);
        }
        if (ev.recipients?.length) return Array.from(new Set([ev.actorId, ...ev.recipients]));
        return [ev.actorId];
    }

    private isContextCreatingAction(ev: CanonicalEvent): boolean {
        const action = this.actionSpace.actions.find(a => a.name === ev.action);
        return action?.canCreateSpace || false;
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
        const visible = this.events.filter(e => e.visibility.includes(actorId)).slice(-20);
        const byCtx = new Map<string, CanonicalEvent[]>();
        for (const e of visible) {
            const key = e.contextId ?? 'global';
            if (!byCtx.has(key)) byCtx.set(key, []);
            byCtx.get(key)!.push(e);
        }
        let s = "Recent activity you can see:\n\n";
        for (const [ctxId, evs] of byCtx) {
            const ctx = this.universe.initialSpaces.find(sp => sp.id === ctxId);
            const name = (ctx?.data as any)?.name ?? ctxId;
            s += `In ${name}:\n`;
            for (const e of evs.slice(-5)) {
                const who = this.universe.agents.find(a => a.id === e.actorId)?.name ?? e.actorId;
                s += `- ${who}: ${e.content ?? e.action}\n`;
            }
            s += "\n";
        }
        const myCtx = Array.from(this.spaceMembers.entries())
            .filter(([_, m]) => m.has(actorId))
            .map(([id]) => (this.universe.initialSpaces.find(s => s.id === id)?.data as any)?.name ?? id);
        s += `\nYou are in these contexts: ${myCtx.join(', ')}\n`;
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

