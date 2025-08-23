import { z } from 'zod';

export const actionSpaceSchema = z.object({
    actions: z.array(z.object({
        name: z.string(),
        description: z.string(),
        requiredParams: z.array(z.string()),
        createsEntity: z.string(),
        visibilityRule: z.string(),
        canCreateSpace: z.boolean().default(false),
        spaceParameter: z.string().optional(),
        visibilityComputation: z.union([
            z.object({ method: z.literal('space_members'), spaceField: z.string() }),
            z.object({ method: z.literal('explicit_recipients'), recipientFields: z.array(z.string()).min(1) }),
            z.object({ method: z.literal('everyone') })
        ]).optional()
    })),

    spaceTypes: z.array(z.object({
        name: z.string(),
        type: z.enum(['explicit', 'implicit', 'derived']),

        definition: z.object({
            explicit: z.object({
                tableName: z.string(),
                membershipTable: z.string().optional()
            }).optional(),
            implicit: z.object({
                emergesFrom: z.string()
            }).optional(),
            derived: z.object({
                computeRule: z.string()
            }).optional()
        }),

        supportsActions: z.array(z.string())
    }))
});

export type ActionSpace = z.infer<typeof actionSpaceSchema>;

export const universeStateSchema = z.object({
    agents: z.array(z.object({
        id: z.string(),
        name: z.string(),
        activityLevel: z.number().min(0).max(1),
        systemPrompt: z.string()
    })),

    initialSpaces: z.array(z.object({
        id: z.string(),
        type: z.string(),
        data: z.record(z.any())
    })),

    memberships: z.array(z.object({
        agentId: z.string(),
        spaceId: z.string()
    }))
});

export type UniverseState = z.infer<typeof universeStateSchema>;

// Canonical, service-agnostic event shape the simulator emits
export const canonicalEventSchema = z.object({
    action: z.string(),
    actorId: z.string(),
    contextId: z.string().optional(),    // concrete context id (channel/doc/thread/account), if applicable
    recipients: z.array(z.string()).optional(), // for point-to-point actions
    parentId: z.string().optional(),      // reply/derivation anchor
    content: z.string().optional(),
    metadata: z.record(z.any()).optional()
});

export type CanonicalEvent = z.infer<typeof canonicalEventSchema> & {
    id: string;
    timestamp: Date;
    visibility: string[];
};

// Legacy simulator Event (retained for compatibility inside simulator only)
export const eventSchema = z.object({
    action: z.string().describe('Action name from action space'),
    parameters: z.record(z.any()).describe('Action parameters'),
    targetSpace: z.string().optional().describe('Where this happens'),
    content: z.string().optional().describe('Message/content if applicable'),
    metadata: z.record(z.any()).optional()
});

export type Event = z.infer<typeof eventSchema> & {
    id: string;
    timestamp: Date;
    actorId: string;
    visibility: string[];  // Computed by simulator
};
