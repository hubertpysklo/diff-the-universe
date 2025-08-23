import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { type ActionSpace, type UniverseState, type Event, eventSchema } from './interfaces';

type Agent = UniverseState['agents'][number];

class UniverseSimulator {
    private events: Event[] = [];
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
        // Set up initial space memberships
        for (const membership of this.universe.memberships) {
            if (!this.spaceMembers.has(membership.spaceId)) {
                this.spaceMembers.set(membership.spaceId, new Set());
            }
            this.spaceMembers.get(membership.spaceId)!.add(membership.agentId);
        }
    }

    async simulate(numEvents: number): Promise<Event[]> {
        for (let i = 0; i < numEvents; i++) {
            const event = await this.simulateNextEvent();
            this.events.push(event);

            // Handle space-creating actions
            if (this.isSpaceCreatingAction(event)) {
                this.handleSpaceCreation(event);
            }

            // Advance time realistically
            this.advanceTime();
        }

        return this.events;
    }

    private async simulateNextEvent(): Promise<Event> {
        // 1. Select next actor (weighted by activity level)
        const actor = this.selectActor();

        // 2. Build context for this actor
        const context = this.buildContext(actor.id);

        // 3. Generate action (ID-first targeting)
        const generatedAction = await this.generateAction(actor, context);

        // 4. Ensure action-space compatibility; remap if needed
        const targetId = generatedAction.targetSpace;
        const actionName = generatedAction.action;
        if (targetId) {
            const spaceType = this.universe.initialSpaces.find(s => s.id === targetId)?.type;
            const supports = this.actionSpace.spaceTypes.find(t => t.name === spaceType)?.supportsActions ?? [];
            if (!supports.includes(actionName)) {
                // Pick first space the actor belongs to that supports this action
                const candidateSpaceId = this.pickFirstSupportedSpace(actor.id, actionName);
                if (candidateSpaceId) {
                    generatedAction.targetSpace = candidateSpaceId;
                }
            }
        }

        // 5. Compute visibility
        const visibility = this.computeVisibility(generatedAction, actor.id);

        // 6. Create full event
        return {
            id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date(this.currentTime),
            actorId: actor.id,
            visibility,
            ...generatedAction
        };
    }

    private pickFirstSupportedSpace(actorId: string, actionName: string): string | undefined {
        for (const [spaceId, members] of this.spaceMembers.entries()) {
            if (!members.has(actorId)) continue;
            const spaceType = this.universe.initialSpaces.find(s => s.id === spaceId)?.type;
            const supports = this.actionSpace.spaceTypes.find(t => t.name === spaceType)?.supportsActions ?? [];
            if (supports.includes(actionName)) return spaceId;
        }
        return undefined;
    }

    private selectActor(): Agent {
        // Weighted random selection based on activity level
        const weights = this.universe.agents.map(a => a.activityLevel);
        const totalWeight = weights.reduce((a, b) => a + b, 0);

        let random = Math.random() * totalWeight;
        for (let i = 0; i < this.universe.agents.length; i++) {
            random -= weights[i];
            if (random <= 0) {
                return this.universe.agents[i];
            }
        }

        return this.universe.agents[0]; // Fallback
    }

    private buildContext(actorId: string): string {
        // Get events visible to this actor
        const visibleEvents = this.events
            .filter(e => e.visibility.includes(actorId))
            .slice(-20); // Last 20 visible events

        // Group by space for better context
        const bySpace = new Map<string, Event[]>();
        for (const event of visibleEvents) {
            const space = event.targetSpace || 'general';
            if (!bySpace.has(space)) {
                bySpace.set(space, []);
            }
            bySpace.get(space)!.push(event);
        }

        // Format context
        let context = "Recent activity you can see:\n\n";

        for (const [spaceId, events] of bySpace) {
            const spaceObj = this.universe.initialSpaces.find(s => s.id === spaceId);
            const displayName = (spaceObj?.data as any)?.name ?? spaceId;
            context += `In ${displayName}:\n`;
            for (const event of events.slice(-5)) {
                const agent = this.universe.agents.find(a => a.id === event.actorId);
                context += `- ${agent?.name}: ${this.formatEvent(event)}\n`;
            }
            context += "\n";
        }

        // Add available spaces
        const mySpaces = Array.from(this.spaceMembers.entries())
            .filter(([_, members]) => members.has(actorId))
            .map(([spaceId, _]) => {
                const space = this.universe.initialSpaces.find(s => s.id === spaceId);
                const spaceName = (space?.data as any)?.name as string | undefined;
                return spaceName || spaceId;
            });

        context += `\nYou are in these spaces: ${mySpaces.join(', ')}\n`;

        return context;
    }

    private async generateAction(actor: Agent, context: string): Promise<Omit<Event, 'id' | 'timestamp' | 'actorId' | 'visibility'>> {
        // Build allowed action names
        const actionNames = this.actionSpace.actions.map(a => a.name);

        // Build allowed spaces for this actor (membership-based)
        let allowedSpaceIds = Array.from(this.spaceMembers.entries())
            .filter(([_, members]) => members.has(actor.id))
            .map(([spaceId]) => spaceId);

        if (allowedSpaceIds.length === 0) {
            // Fallback to any known spaces
            allowedSpaceIds = this.universe.initialSpaces.map(s => s.id);
        }

        // Dynamic per-turn schema: force action from enum and targetSpaceId from allowed IDs
        const turnEventSchema = z.object({
            action: z.enum(actionNames as [string, ...actionNames[]]),
            parameters: z.record(z.any()).default({}),
            targetSpaceId: z.enum(allowedSpaceIds as [string, ...string[]]),
            content: z.string().optional(),
            metadata: z.record(z.any()).optional()
        });

        // Provide AllowedSpaces to the model with both id and display name
        const allowedSpacesDetail = allowedSpaceIds.map(id => {
            const s = this.universe.initialSpaces.find(sp => sp.id === id);
            const name = (s?.data as any)?.name ?? id;
            const type = s?.type ?? 'Space';
            return { id, name, type };
        });

        const result = await generateObject({
            model: openai('gpt-5-mini'),
            system: actor.systemPrompt,
            prompt: `${context}
            
Rules:
- Choose an action from: ${JSON.stringify(actionNames)}
- Choose targetSpaceId from AllowedSpaces (use the id exactly, not the name)
- If replying, keep it concise and coherent with the recent context

AllowedSpaces:
${JSON.stringify(allowedSpacesDetail, null, 2)}
`,
            schema: turnEventSchema,
            temperature: 0.8,
        });

        const obj = result.object as z.infer<typeof turnEventSchema>;

        // Optional: ensure chosen space supports the chosen action; if not, remap to first supported
        const supports = (spaceId: string) => {
            const spaceType = this.universe.initialSpaces.find(s => s.id === spaceId)?.type;
            const supported = this.actionSpace.spaceTypes.find(t => t.name === spaceType)?.supportsActions ?? [];
            return supported.includes(obj.action);
        };
        let chosenSpace = obj.targetSpaceId;
        if (!supports(chosenSpace)) {
            const firstSupported = allowedSpaceIds.find(id => supports(id));
            if (firstSupported) chosenSpace = firstSupported;
        }

        return {
            action: obj.action,
            parameters: obj.parameters,
            targetSpace: chosenSpace,
            content: obj.content,
            metadata: obj.metadata
        } as any;
    }

    private computeVisibility(action: any, actorId: string): string[] {
        // Based on action type and target, determine visibility

        if (action.targetSpace) {
            // Group space message - visible to all members
            const members = this.spaceMembers.get(action.targetSpace);
            return members ? Array.from(members) : [actorId];
        }

        // Generic point-to-point visibility (DM/email): recipients array or to/cc/bcc or single recipientId
        const recipients = new Set<string>();
        const recArr = action.parameters?.recipients as string[] | undefined;
        const toArr = action.parameters?.to as string[] | undefined;
        const ccArr = action.parameters?.cc as string[] | undefined;
        const bccArr = action.parameters?.bcc as string[] | undefined;
        const recipientId = action.parameters?.recipientId as string | undefined;
        if (Array.isArray(recArr)) recArr.forEach(x => recipients.add(x));
        if (Array.isArray(toArr)) toArr.forEach(x => recipients.add(x));
        if (Array.isArray(ccArr)) ccArr.forEach(x => recipients.add(x));
        if (Array.isArray(bccArr)) bccArr.forEach(x => recipients.add(x));
        if (typeof recipientId === 'string') recipients.add(recipientId);
        if (recipients.size > 0) {
            return [actorId, ...recipients];
        }

        // Default: only visible to actor
        return [actorId];
    }

    private isSpaceCreatingAction(event: Event): boolean {
        const action = this.actionSpace.actions.find(a => a.name === event.action);
        return action?.canCreateSpace || false;
    }

    private handleSpaceCreation(event: Event) {
        // Create new space and add creator as member
        const spaceId = `space_${Date.now()}`;
        const members = new Set<string>([event.actorId]);

        // If action specifies initial members, add them
        if (event.parameters?.members) {
            for (const memberId of event.parameters.members) {
                members.add(memberId);
            }
        }

        this.spaceMembers.set(spaceId, members);

        // Resolve space type dynamically
        const explicitType = (event.parameters?.spaceType as string | undefined);
        const supportedType = this.actionSpace.spaceTypes.find(st => st.supportsActions.includes(event.action))?.name;
        const spaceType = explicitType ?? supportedType ?? 'Space';

        // Add to universe spaces (for tracking)
        this.universe.initialSpaces.push({
            id: spaceId,
            type: spaceType,
            data: {
                name: event.parameters?.name || 'new-space',
                isPrivate: event.parameters?.isPrivate || false
            }
        });

        // Keep UniverseState memberships coherent
        for (const agentId of members) {
            this.universe.memberships.push({ agentId, spaceId });
        }
    }

    private advanceTime() {
        // Realistic time progression
        const timeJump = this.calculateTimeJump();
        this.currentTime = new Date(this.currentTime.getTime() + timeJump);
    }

    private calculateTimeJump(): number {
        const hour = this.currentTime.getHours();

        // Night time: bigger jumps
        if (hour >= 22 || hour < 7) {
            return Math.random() * 8 * 60 * 60 * 1000; // 0-8 hours
        }

        // Work hours: smaller jumps
        if (hour >= 9 && hour < 17) {
            return Math.random() * 10 * 60 * 1000; // 0-10 minutes
        }

        // Other times: medium jumps
        return Math.random() * 60 * 60 * 1000; // 0-1 hour
    }

    private formatEvent(event: Event): string {
        switch (event.action) {
            case 'send_message':
                return event.content || '[message]';
            case 'react_message':
                return `reacted ${event.parameters?.emoji || '👍'}`;
            case 'create_channel':
                return `created ${event.parameters?.name ?? 'space'}`;
            default:
                return event.action;
        }
    }
}

// Usage
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

