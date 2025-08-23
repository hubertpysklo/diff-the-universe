import { neon, NeonQueryFunction } from '@neondatabase/serverless';
import { type CanonicalEvent } from './interfaces';
import { type ActionSpace } from './interfaces';

export class DbPopulator {
    private sql: NeonQueryFunction<false, false>;
    private idMap: Map<string, any> = new Map(); // canonicalId -> dbId

    constructor(databaseUrl: string) {
        this.sql = neon(databaseUrl);
    }

    async populateEvents(events: CanonicalEvent[], actionSpace: ActionSpace) {
        for (const event of events) {
            await this.populateEvent(event, actionSpace);
        }

        console.log(`✓ Successfully populated ${events.length} events`);
    }

    private async populateEvent(event: CanonicalEvent, actionSpace: ActionSpace): Promise<void> {
        try {
            // Handle bootstrap events specially
            if (event.actorId === 'system' && event.action.startsWith('bootstrap_')) {
                await this.handleBootstrapEvent(event, actionSpace);
                return;
            }

            // Find the action definition
            const action = actionSpace.actions.find(a => a.name === event.action);
            if (!action) {
                console.warn(`⚠ Action ${event.action} not found in ActionSpace`);
                return;
            }

            if (!action?.dbWrites) {
                console.warn(`  ⚠ No dbWrites for action ${event.action}, skipping`);
                return;
            }

            for (const write of action.dbWrites) {
                const values = this.mapEventToColumns(event, write.columns, write.staticValues);

                try {
                    // Since neon requires template literals, we need to handle this dynamically
                    // The limitation is that we can't build fully dynamic queries
                    // So we'll need to handle common patterns

                    const result = await this.executeWrite(write, values);

                    // Store returned ID in map if needed
                    if (write.returning && result[0]) {
                        const returnedId = result[0][write.returning];

                        // Map the canonical ID to the database ID
                        if (event.actorId === 'system') {
                            // For bootstrap events, map the entity being created
                            if (event.id.startsWith('bootstrap_user_')) {
                                const agentId = event.id.replace('bootstrap_user_', '');
                                this.idMap.set(agentId, returnedId);
                                console.log(`  Mapped agent ${agentId} -> user ${returnedId}`);
                            } else if (event.id.startsWith('bootstrap_space_')) {
                                const spaceId = event.id.replace('bootstrap_space_', '');
                                this.idMap.set(spaceId, returnedId);
                                console.log(`  Mapped space ${spaceId} -> channel ${returnedId}`);
                            }
                        } else {
                            // For regular events, map the event ID
                            this.idMap.set(event.id, returnedId);
                        }

                        console.log(`  ✓ ${write.op} into ${write.table} (${event.action}) -> id: ${returnedId}`);
                    } else {
                        console.log(`  ✓ ${write.op} into ${write.table} (${event.action})`);
                    }
                } catch (error) {
                    console.error(`  ✗ Failed to ${write.op} into ${write.table}:`, error);
                    // Continue with next event rather than failing entire population
                }
            }
        } catch (error) {
            console.error(`❌ Failed to populate event ${event.id}:`, error);
            throw error;
        }
    }

    private convertValue(value: any, type?: string): any {
        if (!type || type === 'text') {
            return value;
        }

        switch (type) {
            case 'json':
                // If it's already an object/array, stringify it
                if (typeof value === 'object' && value !== null) {
                    return JSON.stringify(value);
                }
                // If it's a string, wrap it in a JSON object
                // This handles message content that needs to be stored as JSON
                if (typeof value === 'string') {
                    return JSON.stringify({ text: value });
                }
                return JSON.stringify(value);
            case 'integer':
                return parseInt(value, 10);
            case 'boolean':
                return Boolean(value);
            case 'timestamp':
                return value instanceof Date ? value.toISOString() : value;
            default:
                return value;
        }
    }

    private async handleBootstrapEvent(event: CanonicalEvent, actionSpace: ActionSpace): Promise<void> {
        if (!actionSpace.bootstrap) {
            console.warn('⚠ No bootstrap configuration in ActionSpace');
            return;
        }

        let table: string;
        let columnSpecs: Record<string, any>;
        let returning: string;
        let rawColumns: Record<string, any>;

        // Determine which bootstrap type this is
        if (event.action === 'bootstrap_create_user' && actionSpace.bootstrap.actors) {
            const config = actionSpace.bootstrap.actors;
            table = config.table;
            returning = config.returning;
            columnSpecs = config.columns;
            rawColumns = event.metadata || {};
        } else if (event.action === 'bootstrap_create_space' && actionSpace.bootstrap.spaces) {
            const config = actionSpace.bootstrap.spaces;
            table = config.table;
            returning = config.returning;
            columnSpecs = config.columns;
            rawColumns = event.metadata || {};
        } else if (event.action === 'bootstrap_create_membership' && actionSpace.bootstrap.memberships) {
            const config = actionSpace.bootstrap.memberships;
            table = config.table;
            returning = 'id'; // Default for memberships
            columnSpecs = {}; // Memberships don't have column specs, just use metadata directly
            rawColumns = event.metadata || {};
        } else {
            console.warn(`⚠ Unknown bootstrap action: ${event.action}`);
            return;
        }

        // Apply type conversions if we have column specs
        const columns: Record<string, any> = {};
        if (Object.keys(columnSpecs).length > 0) {
            console.log(`  DEBUG: Bootstrap event ${event.id} metadata:`, JSON.stringify(rawColumns, null, 2));
            console.log(`  DEBUG: Column specs:`, JSON.stringify(columnSpecs, null, 2));
            // Use column specs to determine what to insert
            for (const [colName, spec] of Object.entries(columnSpecs)) {
                let valueToConvert: any;

                if (spec.source === 'metadata' && spec.transform && typeof spec.transform === 'string' && spec.transform.startsWith('{{')) {
                    // Extract the key from transform like "{{created_at}}" -> "created_at"
                    const match = spec.transform.match(/{{([^}]+)}}/);
                    if (match && match[1]) {
                        valueToConvert = rawColumns[match[1]];
                    }
                } else if (spec.source.startsWith('metadata.')) {
                    // If source is like "metadata.created_at"
                    const key = spec.source.slice(9);
                    valueToConvert = rawColumns[key];
                } else if (spec.source && rawColumns[spec.source] !== undefined) {
                    // If source points directly to a key in rawColumns (e.g., source: "name")
                    valueToConvert = rawColumns[spec.source];
                } else {
                    // Default: try to use colName as the key in rawColumns
                    valueToConvert = rawColumns[colName];
                }

                if (valueToConvert !== undefined) {
                    console.log(`    Converting ${colName}: ${JSON.stringify(valueToConvert)} (type: ${spec.type})`);
                    columns[colName] = this.convertValue(valueToConvert, spec.type);
                }
            }
        } else {
            // For memberships, use raw columns but check for foreign keys
            console.log(`  DEBUG: Processing membership with rawColumns:`, rawColumns);
            console.log(`  DEBUG: Current idMap:`, Array.from(this.idMap.entries()));

            for (const [colName, value] of Object.entries(rawColumns)) {
                // Check if this looks like a canonical ID that needs mapping
                if (typeof value === 'string') {
                    // Check for actor IDs (can use - or _ as separator)
                    if (value.startsWith('agent_') || value.startsWith('agent-') ||
                        value.startsWith('a_') || value.startsWith('a-') ||
                        value.startsWith('user_') || value.startsWith('user-')) {
                        // The value is already the canonical ID (e.g., "agent_maya" or "a-maya-chen")
                        console.log(`    Looking up actor: "${value}"`);
                        const mappedId = this.idMap.get(value);
                        if (!mappedId) {
                            console.error(`    ❌ No mapping found for actor ${value}`);
                        } else {
                            console.log(`    ✓ Mapped ${value} → ${mappedId}`);
                        }
                        columns[colName] = mappedId || value;
                    } else if (value.startsWith('space_') || value.startsWith('space-') ||
                        value.startsWith('s_') || value.startsWith('s-') ||
                        value.startsWith('ch_') || value.startsWith('ch-') ||
                        value.startsWith('ws_') || value.startsWith('ws-')) {
                        // The value is already the canonical ID (e.g., "space_general" or "ws-hq")
                        console.log(`    Looking up space: "${value}"`);
                        const mappedId = this.idMap.get(value);
                        if (!mappedId) {
                            console.error(`    ❌ No mapping found for space ${value}`);
                        } else {
                            console.log(`    ✓ Mapped ${value} → ${mappedId}`);
                        }
                        columns[colName] = mappedId || value;
                    } else {
                        columns[colName] = value;
                    }
                } else {
                    columns[colName] = value;
                }
            }
        }

        // Build and execute the INSERT query
        const columnNames = Object.keys(columns);
        const columnValues = Object.values(columns);
        const placeholders = columnNames.map((_, i) => `$${i + 1}`).join(', ');

        const queryText = `
            INSERT INTO ${table} (${columnNames.join(', ')})
            VALUES (${placeholders})
            ${returning ? `RETURNING ${returning}` : ''}
        `;

        console.log(`  → Executing bootstrap: INSERT INTO ${table}`);
        const result = await this.sql.query(queryText, columnValues);

        // Store the ID mapping
        if (returning && result?.[0]) {
            const returnedId = result[0][returning];

            if (event.id.startsWith('bootstrap_user_')) {
                const agentId = event.id.replace('bootstrap_user_', '');
                // Store with the exact canonical ID that will be used in memberships
                this.idMap.set(agentId, returnedId);
                console.log(`    ✓ Mapped ${agentId} → ${returnedId}`);
            } else if (event.id.startsWith('bootstrap_space_')) {
                const spaceId = event.id.replace('bootstrap_space_', '');
                // Store with the exact canonical ID that will be used in memberships  
                this.idMap.set(spaceId, returnedId);
                console.log(`    ✓ Mapped ${spaceId} → ${returnedId}`);
            }
        }
    }

    private mapEventToColumns(event: CanonicalEvent, columnMap: Record<string, string | { source: string; type?: string }>, staticValues?: Record<string, any>): Record<string, any> {
        const values: Record<string, any> = {};

        for (const [dbColumn, mapping] of Object.entries(columnMap)) {
            // Handle both string and object formats
            const source = typeof mapping === 'string' ? mapping : mapping.source;
            const type = typeof mapping === 'object' ? mapping.type : undefined;

            // Get the raw value from the event
            let rawValue: any;
            if (source === 'actorId') {
                rawValue = event.actorId;
            } else if (source === 'contextId') {
                rawValue = event.contextId;
            } else if (source === 'parentId') {
                rawValue = event.parentId;
            } else if (source === 'content') {
                rawValue = event.content;
            } else if (source === 'timestamp') {
                rawValue = event.timestamp;
            } else if (source.startsWith('metadata.')) {
                const key = source.slice(9); // Remove 'metadata.' prefix
                rawValue = event.metadata?.[key];
            } else if (source.startsWith('idMap.')) {
                const key = source.slice(6); // Remove 'idMap.' prefix
                rawValue = this.idMap.get(key);
            } else if (source.startsWith('static_') && staticValues) {
                // Look up static value
                rawValue = staticValues[source];
            } else {
                // Direct static value
                rawValue = source;
            }

            // Apply type conversion based on type hint
            let finalValue = rawValue;
            if (type === 'fk' && typeof rawValue === 'string') {
                // For foreign keys, try to map through idMap
                const mapped = this.idMap.get(rawValue);
                if (mapped !== undefined) {
                    finalValue = mapped;
                    console.log(`    Mapped FK ${rawValue} -> ${mapped}`);
                } else if (rawValue && !rawValue.match(/^\d+$/)) {
                    // Only warn if it's not already a numeric ID
                    console.log(`    Warning: No ID mapping for FK ${rawValue}, using as-is`);
                }
            } else if (type && rawValue !== null && rawValue !== undefined) {
                // Use the convertValue method for all type conversions
                finalValue = this.convertValue(rawValue, type);
            }

            values[dbColumn] = finalValue;
        }

        return values;
    }

    private coerceValue(value: any, type?: string): any {
        if (value === undefined || value === null) {
            return null;
        }

        switch (type) {
            case 'fk':
                // Foreign key - look up in idMap
                const mapped = this.idMap.get(value);
                if (mapped === undefined) {
                    throw new Error(`Missing ID mapping for foreign key: ${value}. idMap has ${this.idMap.size} entries.`);
                }
                return mapped;

            case 'json':
                // JSON column - stringify if not already a string
                return typeof value === 'string' ? value : JSON.stringify(value);

            case 'integer':
                // Convert to integer
                return parseInt(value, 10);

            case 'boolean':
                // Convert to boolean
                return Boolean(value);

            case 'timestamp':
                // Convert to ISO string if Date, otherwise pass through
                return value instanceof Date ? value.toISOString() : value;

            case 'text':
            default:
                // Text or unspecified - pass through as-is
                return value;
        }
    }

    // This method uses the dbWrites specification to execute the write
    private async executeWrite(write: any, values: Record<string, any>): Promise<any[]> {
        try {
            console.log(`  DEBUG: Attempting ${write.op} on ${write.table} with values:`, values);

            // Build dynamic SQL query
            const columns = Object.keys(values);
            const columnValues = Object.values(values);

            // Create parameterized query
            const columnList = columns.join(', ');
            const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');

            let queryText = `INSERT INTO ${write.table} (${columnList}) VALUES (${placeholders})`;
            if (write.returning) {
                queryText += ` RETURNING ${write.returning}`;
            }

            console.log(`  DEBUG: SQL: ${queryText}`);
            console.log(`  DEBUG: Values:`, columnValues);

            // Use Neon's query method for dynamic SQL
            const result = await this.sql.query(queryText, columnValues);
            return result;

        } catch (error) {
            console.error(`  ✗ SQL execution failed:`, error);
            throw error;
        }
    }
} 