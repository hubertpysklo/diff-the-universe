import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { type ActionSpace, universeStateSchema, type UniverseState } from './interfaces';

export const initializeUniverse = async (
    actionSpace: ActionSpace,
    userRequest: string
): Promise<UniverseState> => {

    const result = await generateObject({
        model: openai('gpt-5'),
        system: `You are a universe orchestrator. Given an action space and user request, create:
        
1. AGENTS: Create realistic users who will generate believable data for this service
   - Each agent needs a name, role, personality traits appropriate for this type of service
   - System prompts should focus on personality, behavior, and communication style
   - DO NOT list specific action names in prompts (they will be injected at runtime)
   - GOAL: Agents should generate realistic, varied interactions that would populate this service's database
   - Consider the service type: what kind of users would actually use this? How do they communicate?
   - Make communication patterns natural for this service (formal vs casual, long vs short, etc.)
   - Agents should create diverse content types and interaction patterns
   - Balance between responding to others and creating new content/discussions
   - Assign selection probabilities based on how active this type of user would be
   
2. INITIAL SPACES: Bootstrap environments where interactions can begin
   - Every universe needs at least one common space
   - Create realistic organizational structure
   
   For CHANNEL-BASED systems (Slack, Discord):
   - Use the discovered space types from the schema
   - Spaces map to actual database entities (channels, rooms)
   
   For RECIPIENT-BASED systems (Email, SMS):
   - Create VIRTUAL GROUPS as spaces (type: "VirtualGroup")
   - These represent mailing lists, distribution groups, or recipient lists
   - Example: { id: "team-all", type: "VirtualGroup", data: { name: "All Team", description: "Everyone in the company" } }
   - When agents act in these spaces, it translates to sending messages to all members

3. MEMBERSHIPS: Who belongs in which spaces initially`,

        prompt: `Create a universe for: "${userRequest}"
        
Space types available from schema: ${JSON.stringify(actionSpace.spaceTypes.map(st => st.name))}

IMPORTANT: 
- If space types look like storage/organizational units (Label, Folder, Tag), create VirtualGroup spaces instead
- VirtualGroup represents a collection of people who communicate together
- For email/messaging systems without channels, ALWAYS use VirtualGroup

Generate:
- agents with diverse personalities, roles and behaviors etc. fitting the request and the service type
- Initial spaces:
  * For Slack/Discord: Use actual space types (Channel, Room)
  * For Email/SMS: OPTIONAL - spaces will emerge from communication patterns
    - You can start with NO spaces and let agents create them by sending emails
    - OR create a few VirtualGroup spaces (e.g., "all-team", "project-x") to seed conversations
  * For channel-based systems: At minimum create one general/common space
- Membership assignments (who belongs to which spaces)

Actions will be injected automatically at runtime from the schema.`,

        schema: universeStateSchema,
        temperature: 0.7,
    });

    return result.object;
};


