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
        
1. AGENTS: Personalities who will interact in this universe
   - Each agent needs a name, role, personality traits
   - System prompts should focus on personality, behavior, and communication style
   - DO NOT list specific action names in prompts (they will be injected at runtime)
   - IMPORTANT: Make agents proactive - they should initiate new discussions relevant to their role, not just respond
   - Include phrases like "proactively shares", "initiates discussions about", "starts conversations on" depending on the agent's role in the universe
   - Agents should naturally post in spaces matching their expertise
   - Assign selection probabilities based on activity level
   
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

IMPORTANT: Agent system prompts should describe personality, role, and behavior patterns ONLY.
Do NOT include action names or instructions about specific actions in agent prompts.
Actions will be injected automatically at runtime from the schema.`,

        schema: universeStateSchema,
        temperature: 0.7,
    });

    return result.object;
};


