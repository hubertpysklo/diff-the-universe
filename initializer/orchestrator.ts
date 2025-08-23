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
   - Their system prompt should reference available actions
   - Assign selection probabilities based on activity level
   
2. INITIAL SPACES: Bootstrap environments where interactions can begin
   - Every universe needs at least one common space
   - Create realistic organizational structure
   - Map to the discovered space types

3. MEMBERSHIPS: Who belongs in which spaces initially`,

        prompt: `Create a universe for: "${userRequest}"
        
Available actions: ${JSON.stringify(actionSpace.actions)}
Space types: ${JSON.stringify(actionSpace.spaceTypes)}

Generate:
- 5 agents with diverse personalities fitting an AI startup
- Initial spaces (at minimum a general/common space)
- Membership assignments`,

        schema: universeStateSchema,
        temperature: 0.7,
    });

    return result.object;
};


