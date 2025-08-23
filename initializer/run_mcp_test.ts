import 'dotenv/config';
import { createTestAgent } from './mcp_test_agent';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { type CanonicalEvent } from './interfaces';

async function main() {
    try {
        // Parse command line arguments
        const projectId = process.env.NEON_PROJECT_ID || process.argv[2];
        const databaseName = process.env.NEON_DATABASE || process.argv[3];
        const simulationFile = process.argv[4];
        const mode = process.argv[5] || 'full'; // 'full', 'discover', 'test', 'verify'
        
        if (!projectId) {
            console.error('Usage: npm run test:mcp <project-id> [database-name] [simulation-file] [mode]');
            console.error('Modes: full (default), discover, test, verify');
            console.error('Environment variables: NEON_PROJECT_ID, NEON_DATABASE, NEON_API_KEY');
            process.exit(1);
        }
        
        if (!process.env.NEON_API_KEY) {
            console.error('Error: NEON_API_KEY environment variable is required');
            process.exit(1);
        }
        
        // Load events if simulation file provided
        let events: CanonicalEvent[] | undefined;
        if (simulationFile) {
            console.log(`→ Loading simulation from ${simulationFile}`);
            const simulationPath = join(process.cwd(), simulationFile);
            const simulationData = JSON.parse(readFileSync(simulationPath, 'utf-8'));
            events = simulationData.events;
            console.log(`  Loaded ${events.length} events from simulation`);
        }
        
        // Create the MCP test agent
        const agent = await createTestAgent();
        
        console.log(`\n🎯 Running in ${mode} mode`);
        console.log(`  Project: ${projectId}`);
        console.log(`  Database: ${databaseName || 'default'}`);
        
        let results: any;
        
        switch (mode) {
            case 'discover':
                // Just discover the database structure
                await agent.initialize(projectId);
                results = await agent.discoverDatabaseStructure(projectId, databaseName);
                console.log('\n📊 Discovery Results:');
                console.log(results.text);
                break;
                
            case 'test':
                // Generate and run tests
                await agent.initialize(projectId);
                results = await agent.generateTestsFromDiscovery(projectId, events, databaseName);
                console.log('\n📊 Test Results:');
                console.log(results.text);
                break;
                
            case 'verify':
                // Verify a specific change (would need before/after states)
                console.log('Verify mode requires before/after states - use full mode for now');
                process.exit(0);
                break;
                
            case 'full':
            default:
                // Run the full test cycle
                results = await agent.runFullTestCycle(projectId, databaseName, events);
                break;
        }
        
        // Save results
        const timestamp = Date.now();
        const outputDir = join(process.cwd(), 'out');
        mkdirSync(outputDir, { recursive: true });
        
        const outputPath = join(outputDir, `mcp_test_${mode}_${timestamp}.json`);
        writeFileSync(outputPath, JSON.stringify(results, null, 2));
        console.log(`\n✓ Saved results to ${outputPath}`);
        
        // Generate summary
        if (results.toolCalls) {
            console.log('\n📈 Summary:');
            console.log(`  Total tool calls: ${results.toolCalls.length}`);
            
            const toolCounts = new Map<string, number>();
            results.toolCalls.forEach((call: any) => {
                toolCounts.set(call.toolName, (toolCounts.get(call.toolName) || 0) + 1);
            });
            
            console.log('  Tool usage:');
            toolCounts.forEach((count, tool) => {
                console.log(`    - ${tool}: ${count} calls`);
            });
        }
        
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

// Example: Creating a test programmatically
export async function createAndRunTest() {
    const agent = await createTestAgent();
    
    // Add a new test
    const newTest = await agent.addTest(
        'Check user count',
        'Verify the number of users in the system',
        'SELECT COUNT(*) as user_count FROM users',
        { user_count: { min: 1, max: 100 } }
    );
    
    // Execute the test
    const results = await agent.executeTestSuite(
        [newTest],
        process.env.NEON_PROJECT_ID!,
        process.env.NEON_DATABASE
    );
    
    return results;
}

// Example: Verifying a change
export async function verifyDatabaseChange(
    beforeSnapshot: any,
    afterSnapshot: any,
    expectedChange: string
) {
    const agent = await createTestAgent();
    await agent.initialize(process.env.NEON_PROJECT_ID!);
    
    const verification = await agent.verifyExpectedChange(
        beforeSnapshot,
        afterSnapshot,
        expectedChange,
        process.env.NEON_PROJECT_ID!,
        process.env.NEON_DATABASE
    );
    
    return verification;
}

main();