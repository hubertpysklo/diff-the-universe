import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { getSchemaSnapshot, type SchemaSnapshot } from './load_schemas';
import { actionSpaceSchema, type ActionSpace } from './interfaces';

export const analyzeSchemaForActionSpace = async (
    schemaSnapshot: SchemaSnapshot
): Promise<ActionSpace> => {
    const schemaDescription = JSON.stringify(schemaSnapshot, null, 2);

    const result = await generateObject({
        model: openai('gpt-5'),
        system: `You are a database schema analyzer that discovers the "action space" of a universe from its SQL schema.

Your job is to understand what kind of system this is (messaging, CRM, project management, etc.) and identify:
1. What ACTIONS can happen (based on tables and their relationships)
2. What SPACES exist for organizing visibility and context
3. How visibility is determined for each action

Key principles:
- Actions map to INSERT operations on tables (send_message → INSERT INTO messages)
- Spaces are organizational boundaries (channels, threads, documents, projects)
- Visibility rules determine who sees what based on memberships, permissions, or recipients

Analyze the schema to find:
- Communication patterns (messages, emails, comments)
- Organizational structures (channels, groups, teams, projects)
- Permission systems (membership tables, access control)
- Content creation (documents, posts, tasks)

For each action, determine:
- What parameters it needs (actor, content, target)
- What entity it creates in the database
- How visibility is determined (channel members, recipients, permissions)
- Whether it can create new spaces

For spaces, identify if they are:
- Explicit: Have their own table (channels, projects, documents)
- Implicit: Emerge from relationships (email threads from reply_to)
- Derived: Computed from patterns (DM conversations from two-person visibility)`,

        prompt: `Analyze this database schema and extract the complete action space:

${schemaDescription}

Identify all possible actions users can take, what spaces exist for organizing content, and how visibility works for each action type.

Consider:
- Tables with foreign keys likely represent relationships and memberships
- Tables with user_id or similar columns are probably content created by users
- Junction tables often represent memberships or permissions
- Tables with parent_id or reply_to suggest threading/hierarchy

Generate a comprehensive action space that covers all interactions possible in this system.`,

        schema: actionSpaceSchema,
        temperature: 0.2
    });

    return result.object;
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

(async () => {
    await testActionSpaceGeneration()
})()