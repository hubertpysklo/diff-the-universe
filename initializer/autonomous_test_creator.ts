import { generateObject, generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';
import { type CanonicalEvent } from './interfaces';

// Schema for autonomous test discovery
const explorationPlanSchema = z.object({
    tablesToExplore: z.array(z.object({
        tableName: z.string(),
        reason: z.string().describe('Why this table is interesting to test'),
        queryStrategy: z.string().describe('How to query this table effectively')
    })),
    relationshipsToTest: z.array(z.object({
        fromTable: z.string(),
        toTable: z.string(),
        relationship: z.string().describe('The relationship type (1:1, 1:many, many:many)'),
        testApproach: z.string()
    })),
    dataPatterns: z.array(z.object({
        pattern: z.string().describe('What pattern to look for'),
        query: z.string().describe('SQL to find this pattern')
    }))
});

const autonomousTestSchema = z.object({
    name: z.string(),
    description: z.string(),
    discoveryQuery: z.string().describe('SQL to explore/understand the data'),
    testQueries: z.array(z.object({
        sql: z.string(),
        purpose: z.string(),
        expectedCharacteristics: z.string().describe('What characteristics the result should have (not exact values)')
    })),
    mutationTest: z.object({
        setupSQL: z.array(z.string()).optional(),
        actionDescription: z.string(),
        verificationSQL: z.string(),
        expectedChange: z.string().describe('What should change in the database')
    }).optional()
});

export class AutonomousTestCreator {
    private discoveredSchema: any = {};
    private discoveredData: any = {};
    
    constructor(
        private mcpTools: any // Will be the MCP tools from Neon
    ) {}
    
    async exploreDatabase(projectId: string, databaseName?: string): Promise<void> {
        console.log('→ Autonomously exploring database structure...');
        
        // Use MCP to get all tables
        const tables = await this.mcpTools.get_database_tables({
            projectId,
            databaseName
        });
        
        console.log(`  Found ${tables.length} tables`);
        
        // For each table, discover its schema
        for (const table of tables) {
            console.log(`  Exploring table: ${table}`);
            const schema = await this.mcpTools.describe_table_schema({
                projectId,
                tableName: table,
                databaseName
            });
            this.discoveredSchema[table] = schema;
            
            // Sample some data to understand patterns
            const sampleData = await this.mcpTools.run_sql({
                projectId,
                sql: `SELECT * FROM ${table} LIMIT 5`,
                databaseName
            });
            this.discoveredData[table] = sampleData;
        }
    }
    
    async generateExplorationPlan(): Promise<z.infer<typeof explorationPlanSchema>> {
        const result = await generateObject({
            model: openai('gpt-4o'),
            system: `You are a database testing expert. Given a database schema, create a plan to thoroughly test it.
            
            Focus on:
            1. Understanding data relationships without assumptions
            2. Finding interesting patterns in the data
            3. Testing both reads and writes
            4. Discovering business logic from the schema
            
            Be creative and thorough. Don't assume what the tables are for - discover it.`,
            
            prompt: `Analyze this discovered database structure and create a testing plan:
            
Schema discovered:
${JSON.stringify(this.discoveredSchema, null, 2)}

Sample data found:
${JSON.stringify(this.discoveredData, null, 2)}

Create a comprehensive plan to:
1. Test all important tables
2. Verify relationships work correctly
3. Find and test data patterns
4. Test mutations that respect constraints`,
            
            schema: explorationPlanSchema,
            temperature: 0.5
        });
        
        return result.object;
    }
    
    async generateAutonomousTests(
        events?: CanonicalEvent[]
    ): Promise<Array<z.infer<typeof autonomousTestSchema>>> {
        const tests: Array<z.infer<typeof autonomousTestSchema>> = [];
        
        // First, explore what's in the database
        const explorationPlan = await this.generateExplorationPlan();
        
        // For each table to explore, generate tests
        for (const tableExploration of explorationPlan.tablesToExplore) {
            const test = await this.generateTestForTable(tableExploration, events);
            tests.push(test);
        }
        
        // For each relationship, generate tests
        for (const relationship of explorationPlan.relationshipsToTest) {
            const test = await this.generateRelationshipTest(relationship);
            tests.push(test);
        }
        
        // For patterns, generate pattern tests
        for (const pattern of explorationPlan.dataPatterns) {
            const test = await this.generatePatternTest(pattern);
            tests.push(test);
        }
        
        return tests;
    }
    
    private async generateTestForTable(
        tableExploration: any,
        events?: CanonicalEvent[]
    ): Promise<z.infer<typeof autonomousTestSchema>> {
        // Use AI to generate a test based on what we discovered
        const result = await generateObject({
            model: openai('gpt-4o'),
            system: `Generate a comprehensive test for a database table based on discovered schema and data.
            Don't make assumptions about what the table is for - test based on what you observe.`,
            
            prompt: `Create a test for table: ${tableExploration.tableName}
            
Reason for testing: ${tableExploration.reason}
Strategy: ${tableExploration.queryStrategy}

Table schema:
${JSON.stringify(this.discoveredSchema[tableExploration.tableName], null, 2)}

Sample data:
${JSON.stringify(this.discoveredData[tableExploration.tableName], null, 2)}

${events ? `Recent events that might have created this data:
${events.slice(-10).map(e => `- ${e.action}: ${e.content?.substring(0, 50)}`).join('\n')}` : ''}

Generate a test that:
1. Explores the data without assumptions
2. Tests retrieval patterns
3. Optionally tests mutations if appropriate`,
            
            schema: autonomousTestSchema,
            temperature: 0.3
        });
        
        return result.object;
    }
    
    private async generateRelationshipTest(
        relationship: any
    ): Promise<z.infer<typeof autonomousTestSchema>> {
        const result = await generateObject({
            model: openai('gpt-4o'),
            system: `Generate a test that verifies database relationships work correctly.`,
            
            prompt: `Create a test for relationship:
From: ${relationship.fromTable}
To: ${relationship.toTable}
Type: ${relationship.relationship}
Approach: ${relationship.testApproach}

Schemas:
From table: ${JSON.stringify(this.discoveredSchema[relationship.fromTable], null, 2)}
To table: ${JSON.stringify(this.discoveredSchema[relationship.toTable], null, 2)}

Generate a test that verifies this relationship integrity.`,
            
            schema: autonomousTestSchema,
            temperature: 0.3
        });
        
        return result.object;
    }
    
    private async generatePatternTest(
        pattern: any
    ): Promise<z.infer<typeof autonomousTestSchema>> {
        const result = await generateObject({
            model: openai('gpt-4o'),
            system: `Generate a test that looks for specific data patterns.`,
            
            prompt: `Create a test for pattern: ${pattern.pattern}
            
Base query: ${pattern.query}

Generate a test that finds and validates this pattern.`,
            
            schema: autonomousTestSchema,
            temperature: 0.3
        });
        
        return result.object;
    }
    
    async executeTests(
        tests: Array<z.infer<typeof autonomousTestSchema>>,
        projectId: string,
        databaseName?: string
    ): Promise<any> {
        const results = [];
        
        for (const test of tests) {
            console.log(`\nExecuting test: ${test.name}`);
            console.log(`  ${test.description}`);
            
            try {
                // Run discovery query
                if (test.discoveryQuery) {
                    const discovery = await this.mcpTools.run_sql({
                        projectId,
                        sql: test.discoveryQuery,
                        databaseName
                    });
                    console.log(`  Discovery: Found ${discovery.length} rows`);
                }
                
                // Run test queries
                for (const testQuery of test.testQueries) {
                    console.log(`  Running: ${testQuery.purpose}`);
                    const result = await this.mcpTools.run_sql({
                        projectId,
                        sql: testQuery.sql,
                        databaseName
                    });
                    console.log(`    Result: ${result.length} rows`);
                    console.log(`    Expected: ${testQuery.expectedCharacteristics}`);
                }
                
                // Run mutation test if present
                if (test.mutationTest) {
                    console.log(`  Mutation test: ${test.mutationTest.actionDescription}`);
                    
                    // Setup
                    if (test.mutationTest.setupSQL) {
                        for (const sql of test.mutationTest.setupSQL) {
                            await this.mcpTools.run_sql({
                                projectId,
                                sql,
                                databaseName
                            });
                        }
                    }
                    
                    // Verify
                    const verification = await this.mcpTools.run_sql({
                        projectId,
                        sql: test.mutationTest.verificationSQL,
                        databaseName
                    });
                    console.log(`    Expected change: ${test.mutationTest.expectedChange}`);
                    console.log(`    Actual result: ${verification.length} rows`);
                }
                
                results.push({
                    test: test.name,
                    status: 'completed',
                    description: test.description
                });
                
            } catch (error) {
                console.error(`  Error: ${error}`);
                results.push({
                    test: test.name,
                    status: 'failed',
                    error: String(error)
                });
            }
        }
        
        return results;
    }
    
    // Main autonomous flow
    async runAutonomousTestGeneration(
        projectId: string,
        databaseName?: string,
        events?: CanonicalEvent[]
    ) {
        console.log('🤖 Starting autonomous test generation...\n');
        
        // 1. Explore the database
        await this.exploreDatabase(projectId, databaseName);
        
        // 2. Generate tests based on exploration
        console.log('\n→ Generating tests based on discoveries...');
        const tests = await this.generateAutonomousTests(events);
        
        console.log(`\n✓ Generated ${tests.length} autonomous tests`);
        
        // 3. Execute tests
        console.log('\n→ Executing tests...');
        const results = await this.executeTests(tests, projectId, databaseName);
        
        // 4. Report results
        console.log('\n📊 Test Results:');
        console.log('─'.repeat(50));
        for (const result of results) {
            const icon = result.status === 'completed' ? '✓' : '✗';
            console.log(`${icon} ${result.test}: ${result.status}`);
            if (result.error) {
                console.log(`  Error: ${result.error}`);
            }
        }
        
        return {
            tests,
            results,
            schema: this.discoveredSchema,
            exploration: await this.generateExplorationPlan()
        };
    }
}