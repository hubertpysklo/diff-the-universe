import 'dotenv/config';
import { generateText, tool, experimental_createMCPClient as createMCPClient } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { type CanonicalEvent } from './interfaces';

// Test discovery and execution agent using actual Neon MCP
export class MCPTestAgent {
    private mcpClient: any;
    private tools: any;

    async initialize(projectId: string) {
        console.log('→ Connecting to Neon MCP server...');

        // Connect to actual Neon MCP server
        this.mcpClient = await createMCPClient({
            transport: {
                type: 'sse',
                url: 'https://mcp.neon.tech/sse',
                headers: {
                    Authorization: `Bearer ${process.env.NEON_API_KEY}`,
                },
            },
        });

        // Get all available Neon MCP tools
        this.tools = await this.mcpClient.tools();

        console.log('✓ Connected to Neon MCP with tools:', Object.keys(this.tools));
    }

    async discoverDatabaseStructure(projectId: string, databaseName?: string) {
        console.log('\n🔍 Discovering database structure using MCP...');

        // Use Vercel AI SDK with MCP tools to discover the database
        const result = await generateText({
            model: openai('gpt-5-mini'),
            system: `You are a database exploration expert. Use the available MCP tools to:
1. List all tables in the database
2. Describe the schema of each table
3. Understand relationships between tables
4. Sample data to understand patterns

Be thorough and systematic. Report what you discover.`,

            prompt: `Explore the database for project ${projectId}${databaseName ? ` and database ${databaseName}` : ''}.
            
Start by getting all tables, then describe each one's schema.`,

            tools: this.tools,
            stopWhen: { stepCountIs: 20 }, // Allow multiple tool calls
        });

        return result;
    }

    async generateTestsFromDiscovery(
        projectId: string,
        events?: CanonicalEvent[],
        databaseName?: string
    ) {
        console.log('\n🧪 Generating tests based on database discovery...');

        // First, discover the database
        const discovery = await this.discoverDatabaseStructure(projectId, databaseName);

        // Now generate tests based on what was discovered
        const testGeneration = await generateText({
            model: openai('gpt-5-mini'),
            system: `You are a test generation expert. Based on the database structure discovered, create comprehensive tests.
            
Generate tests that:
1. Verify data integrity
2. Test relationships between tables
3. Find specific patterns in the data
4. Test mutations if appropriate

Use the MCP tools to actually execute these tests and verify results.`,

            prompt: `Based on this database discovery:
${discovery.text}

${events ? `And these simulated events:
${events.slice(-20).map(e => `- ${e.action}: ${e.content?.substring(0, 100)}`).join('\n')}` : ''}

Generate and execute comprehensive tests. For each test:
1. Describe what you're testing
2. Run the SQL query using run_sql tool
3. Verify the results meet expectations
4. Report pass/fail status`,

            tools: this.tools,
            stopWhen: { stepCountIs: 30 }, // Allow extensive testing
        });

        return testGeneration;
    }

    async executeTestSuite(
        testDefinitions: any[],
        projectId: string,
        databaseName?: string
    ) {
        console.log('\n🚀 Executing test suite with MCP tools...');

        const results = [];

        for (const test of testDefinitions) {
            const execution = await generateText({
                model: openai('gpt-5-mini'),
                system: `You are a test executor. Execute the given test and report results.`,

                prompt: `Execute this test:
Name: ${test.name}
Description: ${test.description}
Query: ${test.query || 'Use appropriate MCP tool'}
Expected: ${test.expected || 'Determine based on context'}

Project: ${projectId}
${databaseName ? `Database: ${databaseName}` : ''}

Use the run_sql tool to execute queries and verify results.`,

                tools: this.tools,
                stopWhen: { stepCountIs: 5 },
            });

            results.push({
                test: test.name,
                result: execution.text,
                toolCalls: execution.toolCalls,
                toolResults: execution.toolResults,
            });
        }

        return results;
    }

    async addTest(
        testName: string,
        testDescription: string,
        testQuery: string,
        expectedResult: any
    ) {
        // This method allows adding tests dynamically
        return {
            name: testName,
            description: testDescription,
            query: testQuery,
            expected: expectedResult,
            createdAt: new Date(),
        };
    }

    async verifyExpectedChange(
        beforeState: any,
        afterState: any,
        expectedChange: string,
        projectId: string,
        databaseName?: string
    ) {
        console.log('\n✅ Verifying expected change...');

        const verification = await generateText({
            model: openai('gpt-5-mini'),
            system: `You are a change verification expert. Verify that the expected change occurred in the database.`,

            prompt: `Verify this change:
Expected: ${expectedChange}

Before state: ${JSON.stringify(beforeState, null, 2)}
After state: ${JSON.stringify(afterState, null, 2)}

Project: ${projectId}
${databaseName ? `Database: ${databaseName}` : ''}

Use MCP tools to query the database and verify the change actually happened.`,

            tools: this.tools,
            stopWhen: { stepCountIs: 10 },
        });

        return verification;
    }

    async runFullTestCycle(
        projectId: string,
        databaseName?: string,
        events?: CanonicalEvent[]
    ) {
        console.log('🤖 Starting full autonomous test cycle with Neon MCP...\n');

        try {
            // Initialize MCP connection
            await this.initialize(projectId);

            // Generate tests from discovery
            const testGeneration = await this.generateTestsFromDiscovery(
                projectId,
                events,
                databaseName
            );

            console.log('\n📊 Test Generation Results:');
            console.log('─'.repeat(50));
            console.log(testGeneration.text);

            // Extract test results from tool calls
            const testResults = testGeneration.toolResults?.map((result: any) => ({
                tool: result.toolName,
                result: result.result,
            }));

            console.log('\n🔧 Tool Executions:');
            testResults?.forEach((tr: any) => {
                console.log(`  - ${tr.tool}: ${JSON.stringify(tr.result).substring(0, 100)}...`);
            });

            return {
                discovery: testGeneration.steps?.[0],
                tests: testGeneration.text,
                toolCalls: testGeneration.toolCalls,
                toolResults: testGeneration.toolResults,
            };

        } finally {
            // Clean up MCP connection
            if (this.mcpClient) {
                await this.mcpClient.close();
                console.log('\n✓ MCP connection closed');
            }
        }
    }
}

// Standalone function for unified test management
export async function createTestAgent() {
    return new MCPTestAgent();
}