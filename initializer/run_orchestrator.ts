import 'dotenv/config';
import { getSchemaSnapshot } from './load_schemas';
import { analyzeSchemaForActionSpace } from './action_creator';
import { initializeUniverse } from './orchestrator';
import { runSimulation } from './simulator';
import { DbPopulator } from './db_populator';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { type CanonicalEvent } from './interfaces';

async function main() {
    try {
        const userRequest = process.argv.slice(2).join(' ');

        console.log('→ Inspecting database schema...');
        const snapshot = await getSchemaSnapshot();

        console.log('→ Deriving action space from schema...');
        const actionSpace = await analyzeSchemaForActionSpace(snapshot);

        // Separate system and agent actions
        const systemActions = actionSpace.actions.filter(a => a.actionType === 'system');
        const agentActions = actionSpace.actions.filter(a => a.actionType === 'agent');

        console.log('Discovered system actions:', systemActions.map(a => a.name).join(', '));
        console.log('Discovered agent actions:', agentActions.map(a => a.name).join(', '));

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

        // NEW: Bootstrap phase - create system entities
        const bootstrapEvents: CanonicalEvent[] = [];

        if (process.env.DATABASE_URL && actionSpace.bootstrap) {
            console.log('\n→ Bootstrap phase: Creating system entities...');

            // Create actors/users using bootstrap instructions
            if (actionSpace.bootstrap.actors) {
                const { table, columns, returning } = actionSpace.bootstrap.actors;

                for (const agent of universe.agents) {
                    const metadata: Record<string, any> = {};

                    // Build metadata based on column mappings
                    for (const [colName, colSpec] of Object.entries(columns)) {
                        let value: any;

                        switch (colSpec.source) {
                            case 'id':
                                value = agent.id;
                                break;
                            case 'name':
                                value = agent.name;
                                break;
                            case 'email':
                                // Use transform if provided, otherwise generate default
                                if (colSpec.transform) {
                                    value = colSpec.transform
                                        .replace('{{id}}', agent.id)
                                        .replace('{{email}}', `${agent.id}@example.com`);
                                } else {
                                    value = `${agent.id}@example.com`;
                                }
                                break;
                            case 'metadata':
                                // Handle metadata based on the type - generate appropriate default values
                                if (colSpec.type === 'timestamp') {
                                    // For timestamps, generate appropriate dates
                                    if (colName === 'created_at') {
                                        value = new Date();
                                    } else if (colName === 'last_login') {
                                        // Set last_login to a recent date
                                        value = new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000); // Random time in last 7 days
                                    } else {
                                        value = new Date();
                                    }
                                } else if (colSpec.type === 'text') {
                                    // For text fields, use empty string as default
                                    value = '';
                                } else if (colSpec.type === 'boolean') {
                                    // For boolean fields, default to false
                                    value = false;
                                } else if (colSpec.type === 'json') {
                                    // For JSON fields, include agent properties
                                    value = { activityLevel: agent.activityLevel };
                                } else {
                                    // For other types, try to use a sensible default
                                    value = null;
                                }
                                break;
                            default:
                                // If source is not recognized, check if it's a direct agent property
                                if (agent[colSpec.source as keyof typeof agent] !== undefined) {
                                    value = agent[colSpec.source as keyof typeof agent];
                                }
                                break;
                        }

                        metadata[colName] = value;
                    }

                    console.log(`  DEBUG: Creating bootstrap event for ${agent.id} with metadata:`, JSON.stringify(metadata, null, 2));

                    bootstrapEvents.push({
                        id: `bootstrap_user_${agent.id}`,
                        timestamp: new Date(),
                        actorId: 'system',
                        action: 'bootstrap_create_user',
                        content: agent.name,
                        metadata,
                        visibility: ['everyone']
                    });
                }
            }

            // Create spaces using bootstrap instructions
            if (actionSpace.bootstrap.spaces) {
                const { table, columns, returning } = actionSpace.bootstrap.spaces;

                for (const space of universe.initialSpaces) {
                    const metadata: Record<string, any> = {};

                    // Build metadata based on column mappings
                    for (const [colName, colSpec] of Object.entries(columns)) {
                        let value: any;

                        switch (colSpec.source) {
                            case 'id':
                                value = space.id;
                                break;
                            case 'name':
                                value = space.data?.name || space.id.replace(/^s_/, '').replace(/_/g, ' ');
                                break;
                            case 'type':
                                value = space.type;
                                break;
                            case 'metadata':
                                // Handle metadata based on the type - generate appropriate default values
                                if (colSpec.type === 'timestamp') {
                                    // For timestamps, use current date
                                    value = new Date();
                                } else if (colSpec.type === 'boolean') {
                                    // For booleans, check if it's is_private
                                    if (colName === 'is_private') {
                                        value = space.data?.is_private || false;
                                    } else {
                                        value = false;
                                    }
                                } else if (colSpec.type === 'text') {
                                    // For text fields like description or color
                                    if (colName === 'description') {
                                        value = space.data?.description || '';
                                    } else if (colName === 'color') {
                                        // Generate a random hex color for labels
                                        const colors = ['#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF', '#FFA500'];
                                        value = space.data?.color || colors[Math.floor(Math.random() * colors.length)];
                                    } else {
                                        value = space.data?.[colName] || '';
                                    }
                                } else if (colSpec.type === 'json') {
                                    // For JSON fields, include space data
                                    value = space.data || {};
                                } else if (colSpec.type === 'fk') {
                                    // For foreign keys (e.g., Gmail labels need user_id)
                                    // Associate with the first agent as a default
                                    if (colName === 'user_id' && universe.agents.length > 0) {
                                        value = universe.agents[0].id;
                                    } else {
                                        value = space.data?.[colName] || null;
                                    }
                                } else {
                                    // Default for unknown types
                                    value = null;
                                }
                                break;
                            default:
                                // Check if it's a direct space property
                                if (space[colSpec.source as keyof typeof space] !== undefined) {
                                    value = space[colSpec.source as keyof typeof space];
                                }
                                break;
                        }

                        // Only apply transforms if source is not 'metadata' 
                        // (metadata source already generates the correct values)
                        if (colSpec.transform && colSpec.source !== 'metadata') {
                            value = colSpec.transform
                                .replace('{{id}}', space.id)
                                .replace('{{name}}', value);
                        }

                        metadata[colName] = value;
                    }

                    bootstrapEvents.push({
                        id: `bootstrap_space_${space.id}`,
                        timestamp: new Date(),
                        actorId: 'system',
                        action: 'bootstrap_create_space',
                        content: space.data?.name || space.id,
                        metadata,
                        visibility: ['everyone']
                    });
                }
            }

            // Create memberships using bootstrap instructions
            if (actionSpace.bootstrap.memberships) {
                const { table, actorColumn, spaceColumn } = actionSpace.bootstrap.memberships;

                for (const membership of universe.memberships) {
                    bootstrapEvents.push({
                        id: `bootstrap_membership_${membership.agentId}_${membership.spaceId}`,
                        timestamp: new Date(),
                        actorId: 'system',
                        action: 'bootstrap_create_membership',
                        content: `${membership.agentId} joins ${membership.spaceId}`,
                        metadata: {
                            [actorColumn]: membership.agentId,
                            [spaceColumn]: membership.spaceId
                        },
                        visibility: ['everyone']
                    });
                }
            }

            console.log(`  Created ${bootstrapEvents.length} bootstrap events`);
        }

        console.log('\n→ Running simulator for 20 turns...');
        const simulationEvents = await runSimulation(universe, actionSpace, 5);

        // Combine bootstrap and simulation events
        const allEvents = [...bootstrapEvents, ...simulationEvents];

        for (const e of allEvents) {
            console.log(`event ${e.id} @ ${e.timestamp.toString()} :: actor=${e.actorId} context=${e.contextId ?? 'none'}`);
            console.log(`  visibility: ${e.visibility.join(', ')}`);
            console.log(`  action=${e.action} content="${e.content?.substring(0, 50)}..."`);
        }

        // Save output
        const outDir = join(process.cwd(), 'out');
        mkdirSync(outDir, { recursive: true });
        const outputPath = join(outDir, `simulation_${Date.now()}.json`);
        writeFileSync(outputPath, JSON.stringify({ universe, events: allEvents }, null, 2));
        console.log(`\n✓ Saved simulation to ${outputPath}`);

        // Populate database if DATABASE_URL is set
        if (process.env.DATABASE_URL) {
            console.log('\n→ Populating database...');
            const populator = new DbPopulator(process.env.DATABASE_URL);

            // No need for initializeIdMap anymore - bootstrap events create the entities
            await populator.populateEvents(bootstrapEvents, actionSpace);

            console.log('  Populating simulation events...');
            await populator.populateEvents(simulationEvents, actionSpace);
        } else {
            console.log('\n⚠ Skipping DB population (DATABASE_URL not set)');
        }

    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

main(); 