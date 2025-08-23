import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { getSchemaSnapshot, type SchemaSnapshot } from './load_schemas';
import { actionSpaceSchema, type ActionSpace } from './interfaces';

export const analyzeSchemaForActionSpace = async (
    schemaSnapshot: SchemaSnapshot
): Promise<ActionSpace> => {
    const schemaDescription = JSON.stringify(schemaSnapshot, null, 2);

    console.log('→ Analyzing schema with tables:', schemaSnapshot.tables.map(t => t.name).join(', '));

    const userPrompt = `
Given this database schema, identify ALL ACTIONS in this multi-user system, categorized as:

1. SYSTEM/ADMIN ACTIONS (for bootstrap):
   - Creating users, workspaces, organizations
   - Setting up initial spaces/channels/rooms
   - Any setup that must happen BEFORE agents can interact

2. AGENT ACTIONS (for simulation):
   - Sending messages, posting content
   - Joining/leaving spaces
   - Reacting, replying, sharing
   - Any action a normal user would perform

${schemaDescription}

For each action, provide:
1. The action name and description
2. actionType: 'system' or 'agent'
3. Required parameters (what must be provided)
4. What entity/table it creates
5. The visibility rule (who can see the result)
6. The visibility computation method (MUST be one of: space_members, explicit_recipients, or everyone)
7. Database write specifications (exact table, columns, and mappings)

IMPORTANT: 
- Include BOTH system and agent actions
- System actions typically have visibility='everyone' and create foundational entities
- Agent actions operate within the context created by system actions
- For visibilityComputation, you MUST choose one of these three methods:
  * space_members: visibility based on membership in a space/channel/room
  * explicit_recipients: visibility based on an explicit list of recipients
  * everyone: visible to all users
- Do NOT use "custom" visibility - pick the closest standard pattern
- Map each action to its database operations (INSERT/UPDATE with column mappings)
- Include contextId and parentId in requiredParams where appropriate

Analyze the foreign keys and relationships to determine:
- Which tables represent core entities (users, workspaces) that need system actions
- Which tables represent "spaces" (channels, rooms, groups, etc.)
- Which tables represent "memberships" (who can access what)
- Which actions create new spaces vs post content in existing spaces
- How visibility is controlled (membership tables, recipient fields, etc.)
`;

    try {
        const result = await generateObject({
            model: openai('gpt-5'),
            system: `You are a database schema analyzer. Your job is to map agent actions DIRECTLY to database operations.

CRITICAL: Generate ALL THREE PARTS: actions, spaceTypes, AND bootstrap instructions.

Part 1: ACTIONS
- System actions (actionType: 'system'): Actions for bootstrapping entities (create_user, create_channel, etc.)
- Agent actions (actionType: 'agent'): Actions that agents perform during simulation (post_message, join_channel, etc.)

For each action, provide:
1. Name, description, requiredParams
2. actionType: 'system' or 'agent'
3. createsEntity: (REQUIRED) The name of the entity/table this action creates. Should be a string.
4. visibilityComputation: (REQUIRED) How to determine who can see this action:
   - For actions in spaces/channels: { method: 'space_members', spaceField: 'channel_id' }
   - For direct messages: { method: 'explicit_recipients', recipientFields: ['recipient_id'] }
   - For system/public actions: { method: 'everyone' }
5. dbWrites: Array of database operations with:
   - op: 'insert' or 'update'
   - table: target table name
   - columns: Map of column_name to { source: string, type?: string }
     
     AVAILABLE SOURCES (use these exact strings):
     * 'actorId' - The agent/user performing the action (use for user_id, sender, etc.)
     * 'contextId' - The space/channel where action occurs (use for channel_id, etc.)
     * 'content' - The message content from the event
     * 'timestamp' - Current timestamp
     * 'metadata.X' - Access parameter X from the action (e.g., 'metadata.subject', 'metadata.recipient')
     * 'static_X' - Reference a static value defined in staticValues
     
     EXAMPLE for send_email:
     columns: {
       "id": { "source": "metadata.message_id", "type": "text" },
       "user_id": { "source": "actorId", "type": "fk" },
       "sender": { "source": "actorId", "type": "text" },
       "recipient": { "source": "metadata.recipient", "type": "text" },
       "subject": { "source": "metadata.subject", "type": "text" },
       "content": { "source": "content", "type": "text" },
       "sent_date": { "source": "timestamp", "type": "timestamp" }
     }
     
     Type hints (ALWAYS include for foreign keys):
     * 'fk' - Foreign key reference (will be mapped to database ID)
     * 'json' - JSON data (will be wrapped in JSON object if string)
     * 'text' - Plain text
     * 'integer' - Number
     * 'boolean' - True/false
     * 'timestamp' - Date/time
     
   - staticValues: (optional) For static values referenced in columns
   - returning: Column to return after operation

Part 2: SPACE TYPES
Identify the types of spaces/contexts where actions can occur:
- Look for tables that represent containers (channels, rooms, groups, workspaces, labels, folders)
- For each space type, provide:
  * name: The type name (e.g., "Channel", "Workspace", "Label")
  * type: 'explicit' (has its own table)
  * definition: { explicit: { tableName: "the_table", membershipTable: "optional_membership_table" } }
  * supportsActions: Array of action names that can occur in this space type

Part 3: BOOTSTRAP
Provide explicit instructions for creating initial entities:

bootstrap.actors:
- table: The users/actors table name
- columns: Object mapping each DB column to its configuration:
  Example:
  {
    "name": { "source": "name", "type": "text" },
    "email": { "source": "email", "type": "text", "transform": "{{id}}@example.com" }
  }
  Each column MUST be an object with:
  * source: MUST be one of: 'id' | 'name' | 'email' | 'metadata'
    - 'id': uses the agent's ID
    - 'name': uses the agent's name  
    - 'email': uses the agent's email
    - 'metadata': for columns that need generated values (timestamps, etc.)
  * type: 'fk' | 'json' | 'text' | 'integer' | 'boolean' | 'timestamp' (optional)
  * transform: Optional template like "{{id}}@example.com"
- returning: Which column to return (usually 'id')

bootstrap.spaces (OPTIONAL - only if service has shared spaces):
- table: The spaces/channels table name  
- columns: Object mapping each DB column to its configuration
  Each column MUST be an object with:
  * source: MUST be one of: 'id' | 'name' | 'type' | 'metadata'
    - 'id': uses the space's ID
    - 'name': uses the space's name
    - 'type': uses the space's type
    - 'metadata': for columns that need generated values (foreign keys, colors, timestamps, etc.)
  * type: The DB column type (optional)
  * transform: Optional template
- returning: Which column to return

bootstrap.memberships (OPTIONAL - only if service has shared spaces with membership):
- table: The membership/join table name
- actorColumn: Column name for user FK (string)
- spaceColumn: Column name for space FK (string)

IMPORTANT: 
- Only include bootstrap.spaces and bootstrap.memberships if the service actually has shared collaborative spaces
- bootstrap.actors.columns and bootstrap.spaces.columns MUST be objects where each value is an object with source/type/transform, NOT simple strings!
- Do NOT use paths like 'metadata.user_id' in bootstrap - just use 'metadata' as the source

Column type hints (ALWAYS include for foreign keys):
- 'fk': Foreign key reference
- 'json': JSON data
- 'integer': Integer number
- 'boolean': True/false
- 'timestamp': Date/time
- 'text': String (default if not specified)`,
            messages: [
                {
                    role: 'user',
                    content: `Analyze this database schema and generate:
1. ALL ACTIONS (system and agent) that map to database operations
2. BOOTSTRAP instructions for creating initial entities

${JSON.stringify(schemaSnapshot, null, 2)}

Requirements:
- Include ALL actions - both system (for bootstrapping) and agent (for simulation)
- Mark each action with actionType: 'system' or 'agent'
- EVERY action MUST have visibilityComputation defined:
  * For chat/messages in channels: { method: 'space_members', spaceField: 'channel_id' }
  * For direct messages: { method: 'explicit_recipients', recipientFields: ['recipient_id'] }
  * For system actions and public events: { method: 'everyone' }
- Map each action to specific database write operations
- Include type hints in column mappings, especially for foreign keys
- Provide bootstrap instructions for actors, spaces, and memberships`
                }
            ],
            schema: actionSpaceSchema,
            temperature: 0.0
        });

        // Debug logging
        console.log('\n📋 Raw LLM response:', JSON.stringify(result.object, null, 2));

        // Log what was discovered
        console.log('\n✅ Discovered ActionSpace:');
        if (result.object.actions && result.object.actions.length > 0) {
            for (const action of result.object.actions) {
                console.log(`  - ${action.name}:`);
                console.log(`    • Creates: ${action.createsEntity}`);
                console.log(`    • Type: ${action.actionType || 'agent'}`);
                console.log(`    • Visibility: ${action.visibilityComputation?.method || 'undefined'}`);
                if (action.dbWrites) {
                    console.log(`    • DB writes: ${action.dbWrites.map(w => `${w.op} into ${w.table}`).join(', ')}`);
                } else {
                    console.warn(`    ⚠ WARNING: No dbWrites defined!`);
                }
            }
        } else {
            console.error('⚠ WARNING: No actions discovered from schema!');
        }

        console.log('\nSpace Types:');
        if (result.object.spaceTypes && result.object.spaceTypes.length > 0) {
            for (const space of result.object.spaceTypes) {
                console.log(`  - ${space.name} (${space.type}): supports ${space.supportsActions.join(', ')}`);
            }
        } else {
            console.warn('⚠ WARNING: No space types discovered!');
        }

        return result.object;
    } catch (error) {
        console.error('❌ Error in analyzeSchemaForActionSpace:', error);
        throw error;
    }
};


async function testActionSpaceGeneration() {
    const schemaSnapshot = await getSchemaSnapshot();
    const actionSpace = await analyzeSchemaForActionSpace(schemaSnapshot);

    console.log('Discovered Action Space:');
    console.log(JSON.stringify(actionSpace, null, 2));

    // Now this action space can be used to:
    // 1. Create agents that know what actions are available
    // 2. Guide the simulation with proper visibility rules
    // 3. Map generated events to SQL operations
}

// Commented out - this was running automatically and confusing the logs
// (async () => {
//     await testActionSpaceGeneration()
// })()