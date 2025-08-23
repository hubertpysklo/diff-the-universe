import 'dotenv/config';
import { readFileSync } from 'fs';
import { join } from 'path';
import { generateTests, testsToSQL } from './test_creator';
import { type CanonicalEvent, type ActionSpace, type UniverseState } from './interfaces';

async function main() {
    try {
        // Load the most recent simulation output
        const simulationFile = process.argv[2];
        if (!simulationFile) {
            console.error('Usage: npm run test:create <simulation-output-file>');
            console.error('Example: npm run test:create out/simulation_1234567890.json');
            process.exit(1);
        }
        
        const simulationPath = join(process.cwd(), simulationFile);
        const simulationData = JSON.parse(readFileSync(simulationPath, 'utf-8'));
        
        const events: CanonicalEvent[] = simulationData.events;
        const universe: UniverseState = simulationData.universe;
        
        // Load action space (we need to reconstruct it or save it with simulation)
        // For now, create a minimal action space from the events
        const actionSpace: ActionSpace = {
            actions: extractActionsFromEvents(events),
            spaceTypes: extractSpaceTypesFromUniverse(universe)
        };
        
        console.log('→ Analyzing simulation with', events.length, 'events...');
        console.log('→ Found', universe.agents.length, 'agents and', universe.initialSpaces.length, 'spaces');
        
        // Generate tests
        console.log('\n→ Generating test suite...');
        const testSuite = await generateTests(
            events,
            actionSpace,
            universe,
            process.argv[3] // Optional focus area
        );
        
        console.log(`✓ Generated ${testSuite.tests.length} tests`);
        console.log('\nTest Types:');
        const retrievalTests = testSuite.tests.filter(t => t.type === 'retrieval');
        const mutationTests = testSuite.tests.filter(t => t.type === 'mutation');
        console.log(`  - Retrieval: ${retrievalTests.length}`);
        console.log(`  - Mutation: ${mutationTests.length}`);
        
        console.log('\nTests:');
        for (const test of testSuite.tests) {
            console.log(`  [${test.type}] ${test.name}`);
            console.log(`    ${test.description}`);
        }
        
        // Convert to SQL
        console.log('\n→ Converting to SQL format...');
        const sqlTests = testsToSQL(testSuite);
        
        // Save the test suite
        const outputPath = simulationFile.replace('.json', '_tests.sql');
        require('fs').writeFileSync(outputPath, sqlTests);
        console.log(`✓ Saved SQL tests to ${outputPath}`);
        
        // Also save the structured test suite
        const testSuitePath = simulationFile.replace('.json', '_tests.json');
        require('fs').writeFileSync(testSuitePath, JSON.stringify(testSuite, null, 2));
        console.log(`✓ Saved test suite to ${testSuitePath}`);
        
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

// Helper function to extract action definitions from events
function extractActionsFromEvents(events: CanonicalEvent[]): ActionSpace['actions'] {
    const actionSet = new Set(events.map(e => e.action));
    return Array.from(actionSet).map(actionName => ({
        name: actionName,
        description: `Action: ${actionName}`,
        requiredParams: [],
        createsEntity: 'unknown',
        visibilityRule: 'inferred'
    }));
}

// Helper function to extract space types from universe
function extractSpaceTypesFromUniverse(universe: UniverseState): ActionSpace['spaceTypes'] {
    const typeSet = new Set(universe.initialSpaces.map(s => s.type));
    return Array.from(typeSet).map(typeName => ({
        name: typeName,
        type: 'explicit' as const,
        definition: {
            explicit: {
                tableName: typeName,
                membershipTable: 'members'
            }
        },
        supportsActions: []
    }));
}

main();