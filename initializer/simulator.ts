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
        console.log('→ Initializing memberships...');
        for (const membership of this.universe.memberships) {
            if (!this.spaceMembers.has(membership.spaceId)) {
                this.spaceMembers.set(membership.spaceId, new Set());
            }
            this.spaceMembers.get(membership.spaceId)!.add(membership.agentId);
        }

        // Validate memberships
        for (const [spaceId, members] of this.spaceMembers) {
            if (members.size === 0) {
                console.error(`  ❌ ERROR: Space ${spaceId} has NO members!`);
            } else {
                console.log(`  ✓ Space ${spaceId}: ${members.size} members`);
            }
        }

        // Check if all agents are in at least one space
        for (const agent of this.universe.agents) {
            const spaces = Array.from(this.spaceMembers.entries())
                .filter(([_, members]) => members.has(agent.id))
                .map(([spaceId]) => spaceId);
            if (spaces.length === 0) {
                console.warn(`  ⚠ WARNING: Agent ${agent.name} (${agent.id}) is not in ANY spaces!`);
            } else {
                console.log(`  ✓ Agent ${agent.name}: in ${spaces.length} space(s)`);
            }
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

        // Get allowed contexts for this actor
        const allowedContextIds = Array.from(this.spaceMembers.entries())
            .filter(([_, members]) => members.has(actor.id))
            .map(([spaceId]) => spaceId);

        if (allowedContextIds.length === 0) {
            throw new Error(`Actor ${actor.id} has no allowed contexts`);
        }

        // Dynamic schema: action with content/parameters AND context
        const turnSchema = z.object({
            action: z.enum(this.actionSpace.actions.map(a => a.name) as [string, ...string[]]),
            contextId: z.string().optional().describe('The space/channel where this action should occur (if applicable)'),
            parameters: z.record(z.string()).describe('Parameters for the action (e.g., message content, metadata fields)')
        });

        let obj: z.infer<typeof turnSchema>;
        try {
            // Inject available actions into the agent's prompt
            const enhancedSystemPrompt = `${actor.systemPrompt}

AVAILABLE ACTIONS (use exactly these names):
${this.actionSpace.actions.map(a => {
                const params = a.requiredParams?.length > 0 ? ` (requires: ${a.requiredParams.join(', ')})` : '';
                return `- ${a.name}: ${a.description}${params}`;
            }).join('\n')}

When calling an action, you MUST provide ALL required parameters in the 'parameters' field.
The actual MESSAGE CONTENT goes in a parameter called "message" or "content".
Other required parameters should be generated with appropriate values:

Examples of parameter generation:
- message_id: Generate unique ID like "msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}"
- recipient: Use actual email address or agent ID of the recipient
- sender: Use your own email or agent ID
- subject: Generate appropriate email subject line
- thread_id: For replies, use parent message's thread_id or generate new one like "thread_${Date.now()}"
- filename: Generate realistic filename like "report.pdf" or "design_v2.png"
- mime_type: Use standard MIME types like "application/pdf", "image/png", etc.
- size_bytes: Generate realistic file size like 1024000 (1MB)
- label_id: Use the ID of an existing label
- Any other required params: Generate contextually appropriate values`;

            const gen = generateObject({
                model: openai('gpt-5-mini'),
                system: enhancedSystemPrompt,
                prompt: `${context}

Your accessible spaces and what actions they support:
${allowedContextIds.map(id => {
                    const space = this.universe.initialSpaces.find(s => s.id === id);
                    const spaceType = space?.type;
                    const supportedActions = this.actionSpace.spaceTypes.find(t => t.name === spaceType)?.supportsActions ?? [];
                    const memberCount = this.spaceMembers.get(id)?.size || 0;
                    const name = (space?.data as any)?.name || id;

                    // Only show actions that this space actually supports
                    const relevantActions = supportedActions.filter(action =>
                        this.actionSpace.actions.some(a => a.name === action)
                    );

                    // Show the ACTUAL ID that must be used
                    return `- ${id} (name: ${name}, type: ${spaceType}, ${memberCount} members): supports ${relevantActions.join(', ')}`;
                }).join('\n')}

Choose an action to perform and provide:
1. action: The action name from AVAILABLE ACTIONS
2. contextId: The space ID where this action occurs (use the exact ID from the list above, e.g., "mbx_shared")
3. parameters: An object with ALL required parameters for the action, where:
   - The actual MESSAGE CONTENT goes in a parameter called "message" or "content"
   - Other metadata like message_id, recipient, subject, etc. go as separate parameters
   
Example for send_email:
{
  "action": "send_email",
  "contextId": "mbx_shared",
  "parameters": {
    "message_id": "msg_abc123",
    "recipient": "client@example.com",
    "subject": "Project Update",
    "message": "Hi, here's the latest update on the project..."
  }
}`,
                schema: turnSchema,
                temperature: 0.7,
            });
            const res = await withTimeout(gen as any, 45000);
            obj = (res as any).object as z.infer<typeof turnSchema>;
            console.log(`  DEBUG: LLM returned:`, JSON.stringify(obj));
        } catch (err) {
            console.error(`  ERROR: LLM failed:`, err);
            throw err;
        }

        // Now validate the context if provided by LLM
        const def = this.actionSpace.actions.find(a => a.name === obj.action);
        if (!def) {
            console.error(`  ERROR: Action "${obj.action}" not found in action space. Available: ${this.actionSpace.actions.map(a => a.name).join(', ')}`);
            throw new Error(`Invalid action "${obj.action}" - not in action space`);
        }

        // Determine if this action needs a context based on its database writes
        let chosenContext: string | undefined;

        // Check if the action's dbWrites require a context/space/channel
        const needsContext = def.dbWrites?.some(write =>
            Object.values(write.columns || {}).includes('contextId') ||
            Object.values(write.columns || {}).includes('metadata.contextId')
        ) || def?.visibilityComputation?.method === 'space_members';

        if (needsContext) {
            // Use the LLM's chosen context, but validate it
            if (!obj.contextId) {
                throw new Error(`Action ${obj.action} requires a contextId but none was provided`);
            }

            // Validate that:
            // 1. The actor has access to this context
            // 2. The context supports this action type

            const hasAccess = allowedContextIds.includes(obj.contextId);
            if (!hasAccess) {
                throw new Error(`Actor ${actor.id} does not have access to context ${obj.contextId}`);
            }

            const spaceType = this.universe.initialSpaces.find(s => s.id === obj.contextId)?.type;
            const supports = this.actionSpace.spaceTypes.find(t => t.name === spaceType)?.supportsActions ?? [];
            if (!supports.includes(obj.action)) {
                throw new Error(`Context ${obj.contextId} (type: ${spaceType}) does not support action ${obj.action}`);
            }

            chosenContext = obj.contextId;
            console.log(`  DEBUG: Using LLM's chosen context: ${chosenContext}`);
        }

        // Handle parent_id for replies/reactions
        let parentId: string | undefined;

        // Check if action needs a parent (from dbWrites or requiredParams)
        const needsParent = def.dbWrites?.some(write =>
            Object.values(write.columns || {}).includes('parentId') ||
            Object.values(write.columns || {}).includes('parent_id')
        ) || (def?.requiredParams ?? []).includes('parentId');

        if (needsParent) {
            // If the LLM provided a parentId, validate it exists
            if (obj.parameters.parentId) {
                const parentEvent = this.events.find(e => e.id === obj.parameters.parentId);
                if (parentEvent && parentEvent.visibility.includes(actor.id)) {
                    parentId = obj.parameters.parentId;
                    // Also inherit the context from the parent
                    if (!chosenContext && parentEvent.contextId) {
                        chosenContext = parentEvent.contextId;
                        console.log(`  DEBUG: Inherited context from parent: ${chosenContext}`);
                    }
                } else {
                    console.warn(`  WARNING: Invalid or invisible parentId provided: ${obj.parameters.parentId}`);
                }
            }

            // If no valid parent provided, pick the latest visible event in the context
            if (!parentId && chosenContext) {
                parentId = this.pickLatestVisibleEventId(actor.id, chosenContext);
            }
        }

        // Handle recipients for explicit_recipients visibility
        let recipients: string[] | undefined;
        if (def?.visibilityComputation?.method === 'explicit_recipients') {
            // Check if recipients are in parameters, otherwise pick some
            if (obj.parameters.recipients && Array.isArray(obj.parameters.recipients)) {
                recipients = obj.parameters.recipients;
            } else {
                // Pick some members from the context or globally
                const pool = chosenContext
                    ? Array.from(this.spaceMembers.get(chosenContext) ?? [])
                    : this.universe.agents.map(a => a.id);
                recipients = pool.filter(id => id !== actor.id).slice(0, 2);
            }
        }

        // Extract message content from parameters
        const messageContent = obj.parameters.message || obj.parameters.text || obj.parameters.content;

        // Compute visibility based on the inferred structure
        const visibility = this.inferVisibility({
            action: obj.action,
            actorId: actor.id,
            contextId: chosenContext,
            recipients,
            parentId,
            content: messageContent,
            metadata: obj.parameters
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
            metadata: obj.parameters,
            visibility
        };
    }

    private canAgentSeeEvent(agentId: string, event: Partial<CanonicalEvent>): boolean {
        const def = this.actionSpace.actions.find(a => a.name === event.action);
        const method = def?.visibilityComputation?.method;

        // Actor always sees their own actions
        if (event.actorId === agentId) return true;

        if (method === 'space_members' && event.contextId) {
            // Can see if member of the space
            const members = this.spaceMembers.get(event.contextId);
            const canSee = members?.has(agentId) ?? false;
            if (!members) {
                console.warn(`  ⚠ WARNING: No members found for space ${event.contextId} - visibility defaulting to false`);
            }
            return canSee;
        }

        if (method === 'explicit_recipients') {
            // Can see if in recipients list
            const canSee = event.recipients?.includes(agentId) ?? false;
            if (!event.recipients) {
                console.warn(`  ⚠ WARNING: No recipients for explicit_recipients action ${event.action}`);
            }
            return canSee;
        }

        if (method === 'everyone') {
            // Everyone can see
            return true;
        }

        if (method === 'custom' && def?.visibilityComputation) {
            // For custom patterns, we can't guess - use the most logical default
            // If the event has a context, use space-based visibility
            // Otherwise, make it visible to everyone
            if (event.contextId) {
                const members = this.spaceMembers.get(event.contextId);
                return members?.has(agentId) ?? false;
            } else {
                return true;
            }
        }

        // INFER VISIBILITY when not explicitly defined
        if (!method) {
            // For actions in a context (channel/space), use space-based visibility
            if (event.contextId) {
                const members = this.spaceMembers.get(event.contextId);
                const canSee = members?.has(agentId) ?? false;
                return canSee;
            }

            // For actions with explicit recipients, use recipient-based visibility
            if (event.recipients && event.recipients.length > 0) {
                return event.recipients.includes(agentId);
            }

            // System actions should be visible to everyone
            if (def?.actionType === 'system') {
                return true;
            }

            // Default for agent actions without context: only actor can see
            console.warn(`  ⚠ WARNING: Visibility defaulting to actor-only for ${event.action}`);
        }

        // Default: only actor can see
        return false;
    }

    private inferVisibility(ev: Omit<CanonicalEvent, 'id' | 'timestamp' | 'visibility'>): string[] {
        // Still compute for backward compatibility, but we should migrate away from this
        const agents = this.universe.agents.map(a => a.id);
        const visibleTo = agents.filter(agentId => this.canAgentSeeEvent(agentId, ev));

        // Log visibility computation for debugging
        const def = this.actionSpace.actions.find(a => a.name === ev.action);
        console.log(`  DEBUG: Visibility for ${ev.action} (method=${def?.visibilityComputation?.method}): ${visibleTo.length}/${agents.length} agents can see`);
        if (visibleTo.length === 0) {
            console.error(`  ❌ ERROR: Event visible to NO ONE! Action=${ev.action}, actor=${ev.actorId}, context=${ev.contextId}`);
        } else if (visibleTo.length === 1 && visibleTo[0] === ev.actorId) {
            console.warn(`  ⚠ WARNING: Event only visible to actor! This might indicate a membership issue.`);
        }

        return visibleTo;
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
        const visible = this.events.filter(e => this.canAgentSeeEvent(actorId, e)).slice(-50);
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
            .map(([id]) => id);  // Use the actual IDs, not the names
        s += `\nYou are in these spaces: ${myCtx.join(', ')}\n`;

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
            if (this.canAgentSeeEvent(actorId, e) && (!contextId || e.contextId === contextId)) {
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

