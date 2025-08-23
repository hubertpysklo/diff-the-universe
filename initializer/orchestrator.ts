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
   - Map to the discovered space types

3. MEMBERSHIPS: Who belongs in which spaces initially`,

        prompt: `Create a universe for: "${userRequest}"
        
Space types available: ${JSON.stringify(actionSpace.spaceTypes.map(st => st.name))}

Generate:
- 5 agents with diverse personalities fitting the request
- Initial spaces (at minimum a general/common space)
- Membership assignments

Actions will be injected automatically at runtime from the schema.`,

        schema: universeStateSchema,
        temperature: 0.7,
    });

    return result.object;
};


