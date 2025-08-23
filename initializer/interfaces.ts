import { z } from 'zod';

export const actionSpaceSchema = z.object({
    actions: z.array(z.object({
        name: z.string(),
        description: z.string(),
        requiredParams: z.array(z.string()),
        createsEntity: z.string(),
        visibilityRule: z.string().optional(), // Made optional - visibility is inferred from DB structure
        canCreateSpace: z.boolean().default(false),
        spaceParameter: z.string().optional(),

        // NEW: Distinguish action types
        actionType: z.enum(['system', 'agent']).default('agent').describe('System actions are for bootstrap (create users/spaces), agent actions are for simulation'),

        visibilityComputation: z.union([
            z.object({ method: z.literal('space_members'), spaceField: z.string() }),
            z.object({ method: z.literal('explicit_recipients'), recipientFields: z.array(z.string()).min(1) }),
            z.object({ method: z.literal('everyone') }),
            // NEW: Custom visibility patterns for unique schemas
            z.object({
                method: z.literal('custom'),
                description: z.string(),
                // How to compute visibility from the event and database (optional - may just be described)
                computeLogic: z.string().optional()
            })
        ]).describe('REQUIRED: How to determine who can see this action'),

        // NEW: Database write specification
        dbWrites: z.array(z.object({
            op: z.enum(['insert', 'upsert', 'update']).default('insert'),
            table: z.string(),
            columns: z.record(z.string(), z.union([
                z.string(), // Simple string mapping for backward compatibility
                z.object({  // Detailed mapping with type information
                    source: z.string().describe('Source field from event (actorId, contextId, metadata.field, etc)'),
                    type: z.enum(['fk', 'json', 'text', 'integer', 'boolean', 'timestamp']).optional().describe('Data type hint for proper conversion')
                })
            ])).describe('Map of dbColumn to source (string) or {source, type}'),
            staticValues: z.record(z.string(), z.any()).optional().describe('Static values to set'),
            returning: z.string().optional().describe('Column to return (usually primary key)')
        })).optional()
    })),

    spaceTypes: z.array(z.object({
        name: z.string(),
        type: z.enum(['explicit', 'implicit', 'derived']),

        definition: z.object({
            explicit: z.object({
                tableName: z.string(),
                membershipTable: z.string().optional().nullable()
            }).optional(),
            implicit: z.object({
                emergesFrom: z.string()
            }).optional(),
            derived: z.object({
                computeRule: z.string()
            }).optional()
        }),

        supportsActions: z.array(z.string()).describe('Which actions can occur in this space type')
    })),

    // Bootstrap instructions for initial entity creation
    bootstrap: z.object({
        actors: z.object({
            table: z.string().describe('Table name for actors/users'),
            columns: z.record(z.string(), z.object({
                source: z.enum(['id', 'name', 'email', 'metadata']),
                type: z.enum(['fk', 'json', 'text', 'integer', 'boolean', 'timestamp']).optional(),
                transform: z.string().optional().describe('Template for value transformation, e.g., "{{id}}@example.com"')
            })).describe('Column mappings for actor creation'),
            returning: z.string().describe('Column to return and store in idMap')
        }).optional(),

        spaces: z.object({
            table: z.string().describe('Table name for spaces/channels'),
            columns: z.record(z.string(), z.object({
                source: z.enum(['id', 'name', 'type', 'metadata']),
                type: z.enum(['fk', 'json', 'text', 'integer', 'boolean', 'timestamp']).optional(),
                transform: z.string().optional()
            })).describe('Column mappings for space creation'),
            returning: z.string().describe('Column to return and store in idMap')
        }).optional(),

        memberships: z.object({
            table: z.string().describe('Table name for memberships'),
            actorColumn: z.string().describe('Column name for actor/user foreign key'),
            spaceColumn: z.string().describe('Column name for space/channel foreign key')
        }).optional()
    }).optional().describe('Explicit instructions for bootstrapping initial entities')
});

export type ActionSpace = z.infer<typeof actionSpaceSchema>;

// Extract types for database operations
export type DbWrite = {
    op?: 'insert' | 'upsert' | 'update';
    table: string;
    columns: Record<string, string | ColumnMapping>;
    staticValues?: Record<string, any>;
    returning?: string;
};

export type ColumnMapping = {
    source: string;
    type?: 'fk' | 'json' | 'text' | 'integer' | 'boolean' | 'timestamp';
};

export type Action = ActionSpace['actions'][0];

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
