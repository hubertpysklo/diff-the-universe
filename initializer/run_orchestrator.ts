import 'dotenv/config';
import { getSchemaSnapshot } from './load_schemas';
import { analyzeSchemaForActionSpace } from './action_creator';
import { initializeUniverse } from './orchestrator';
import { runSimulation } from './simulator';

async function main() {
    try {
        const userRequest = process.argv.slice(2).join(' ') || 'AI startup in SF with 5 employees';

        console.log('→ Inspecting database schema...');
        const snapshot = await getSchemaSnapshot();

        console.log('→ Deriving action space from schema...');
        const actionSpace = await analyzeSchemaForActionSpace(snapshot);

        console.log('→ Initializing universe...');
        const universe = await initializeUniverse(actionSpace, userRequest);

        console.log('Agents:');
        for (const a of universe.agents) {
            console.log(`- ${a.name} (activity=${a.activityLevel.toFixed(2)})`);
            console.log(a.systemPrompt);
            console.log(a.activityLevel);
            console.log(a.id);
        }

        console.log('\nInitial spaces:');
        for (const s of universe.initialSpaces) {
            console.log(`- ${s.id} [${s.type}]`);
        }

        console.log('\nMemberships (count):', universe.memberships.length);

        console.log('\n→ Running simulator for 20 turns...');
        const events = await runSimulation(universe, actionSpace, 20);
        for (const e of events) {
            console.log(`event ${e.id} @ ${e.timestamp.toString()} :: actor=${e.actorId} space=${e.targetSpace ?? 'unknown'}`);
            console.log(`  visibility: ${e.visibility.join(', ')}`);
            console.log(`  action=${e.action} content=${JSON.stringify(e.content)}`);
        }
    } catch (err) {
        console.error(err);
        process.exit(1);
    }
}

main(); 