import { generateObject } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { type CanonicalEvent, type ActionSpace, type UniverseState } from './interfaces';

// Schema for a single test case
const testCaseSchema = z.object({
    type: z.enum(['retrieval', 'mutation']),
    name: z.string(),
    description: z.string(),

    // For retrieval tests
    query: z.string().optional().describe('SQL query to find data'),
    expectedPattern: z.string().optional().describe('Pattern or content that should be found'),
    expectedCount: z.number().optional().describe('Expected number of results'),

    // For mutation tests  
    action: z.object({
        name: z.string(),
        parameters: z.record(z.any()),
        actorId: z.string(),
        contextId: z.string().optional()
    }).optional().describe('Action to perform'),

    // Expected database changes after mutation
    verificationQueries: z.array(z.object({
        query: z.string(),
        expectedResult: z.any().describe('Expected query result after mutation')
    })).optional(),

    // Success criteria
    assertions: z.array(z.string()).describe('List of assertions that must pass')
});

const testSuiteSchema = z.object({
    tests: z.array(testCaseSchema),
    setupQueries: z.array(z.string()).optional().describe('SQL to run before tests'),
    teardownQueries: z.array(z.string()).optional().describe('SQL to run after tests')
});

export type TestCase = z.infer<typeof testCaseSchema>;
export type TestSuite = z.infer<typeof testSuiteSchema>;

export async function generateTests(
    events: CanonicalEvent[],
    actionSpace: ActionSpace,
    universe: UniverseState,
    focusArea?: string
): Promise<TestSuite> {

    // Analyze the events to understand patterns
    const eventSummary = analyzeEvents(events);

    const result = await generateObject({
        model: openai('gpt-5-mini'),
        system: `You are a test generation expert. Given a simulated universe of events and actions, 
        create comprehensive tests that verify both data retrieval and mutations work correctly.
        
        Consider these test patterns:
        
        RETRIEVAL TESTS:
        - Find specific messages by content
        - Search for activity by a specific user
        - Query messages in a time range
        - Find all messages in a specific context/channel
        - Search for patterns (e.g., questions, mentions)
        
        MUTATION TESTS:
        - Send a message and verify it appears
        - Create a new space/channel and verify membership
        - React to a message and verify the reaction is stored
        - Reply to a thread and verify parent-child relationship
        - Join a space and verify membership table update
        
        Each test should:
        1. Have a clear, specific goal
        2. Use actual data from the simulation where possible
        3. Include precise assertions about expected outcomes
        4. Be independent and not rely on other tests
        
        Focus on testing the actual database operations and relationships.`,

        prompt: `Generate tests for this simulated universe:
        
Event Summary:
${JSON.stringify(eventSummary, null, 2)}

Available Actions:
${actionSpace.actions.map(a => `- ${a.name}: ${a.description}`).join('\n')}

Sample Events (last 10):
${events.slice(-10).map(e =>
            `- ${e.action} by ${e.actorId} in ${e.contextId || 'global'}: "${e.content?.substring(0, 50)}..."`
        ).join('\n')}

Agents in Universe:
${universe.agents.map(a => `- ${a.id}: ${a.name}`).join('\n')}

Spaces:
${universe.initialSpaces.map(s => `- ${s.id} (${s.type}): ${(s.data as any).name}`).join('\n')}

${focusArea ? `Focus Area: ${focusArea}` : ''}

Generate a comprehensive test suite that:
1. Tests finding specific content from the simulation
2. Tests user activity queries  
3. Tests mutations with expected DB changes
4. Uses real IDs and content from the events
5. Covers different action types from the action space`,

        schema: testSuiteSchema,
        temperature: 0.3
    });

    return result.object;
}

function analyzeEvents(events: CanonicalEvent[]) {
    const actionCounts = new Map<string, number>();
    const userActivity = new Map<string, number>();
    const contextActivity = new Map<string, number>();
    const sampleContent: string[] = [];

    for (const event of events) {
        // Count actions
        actionCounts.set(event.action, (actionCounts.get(event.action) || 0) + 1);

        // Count user activity
        userActivity.set(event.actorId, (userActivity.get(event.actorId) || 0) + 1);

        // Count context activity
        if (event.contextId) {
            contextActivity.set(event.contextId, (contextActivity.get(event.contextId) || 0) + 1);
        }

        // Collect sample content
        if (event.content && sampleContent.length < 5) {
            sampleContent.push(event.content.substring(0, 100));
        }
    }

    return {
        totalEvents: events.length,
        actionDistribution: Object.fromEntries(actionCounts),
        topUsers: Array.from(userActivity.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([id, count]) => ({ id, count })),
        topContexts: Array.from(contextActivity.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([id, count]) => ({ id, count })),
        sampleContent,
        timeRange: {
            start: events[0]?.timestamp,
            end: events[events.length - 1]?.timestamp
        }
    };
}

// Test executor using Neon
export async function executeTests(
    testSuite: TestSuite,
    databaseUrl: string
): Promise<TestResults> {
    const results: TestResults = {
        passed: 0,
        failed: 0,
        errors: 0,
        details: []
    };

    // We'll implement the actual execution when we have the Neon connection
    console.log('Test execution would happen here with Neon connection');

    return results;
}

interface TestResults {
    passed: number;
    failed: number;
    errors: number;
    details: Array<{
        testName: string;
        status: 'passed' | 'failed' | 'error';
        message?: string;
        duration?: number;
    }>;
}

// Export function to generate and format tests as SQL
export function testsToSQL(testSuite: TestSuite): string {
    const sqlTests: string[] = [];

    // Setup
    if (testSuite.setupQueries) {
        sqlTests.push('-- Setup');
        sqlTests.push(...testSuite.setupQueries);
        sqlTests.push('');
    }

    // Tests
    for (const test of testSuite.tests) {
        sqlTests.push(`-- Test: ${test.name}`);
        sqlTests.push(`-- ${test.description}`);

        if (test.type === 'retrieval' && test.query) {
            sqlTests.push(test.query);
            if (test.expectedCount !== undefined) {
                sqlTests.push(`-- Expected: ${test.expectedCount} rows`);
            }
            if (test.expectedPattern) {
                sqlTests.push(`-- Should contain: ${test.expectedPattern}`);
            }
        } else if (test.type === 'mutation' && test.verificationQueries) {
            sqlTests.push(`-- Action: ${test.action?.name}`);
            for (const vq of test.verificationQueries) {
                sqlTests.push(vq.query);
                sqlTests.push(`-- Expected: ${JSON.stringify(vq.expectedResult)}`);
            }
        }

        sqlTests.push('');
    }

    // Teardown
    if (testSuite.teardownQueries) {
        sqlTests.push('-- Teardown');
        sqlTests.push(...testSuite.teardownQueries);
    }

    return sqlTests.join('\n');
}