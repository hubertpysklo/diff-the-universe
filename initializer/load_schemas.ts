import { neon } from '@neondatabase/serverless';
import 'dotenv/config';

export type SchemaSnapshot = {
    schema: string;
    tables: Array<{
        name: string;
        columns: Array<{
            name: string;
            type: string;
            nullable: boolean;
            hasDefault: boolean;
        }>;
        primaryKey: string[];
        foreignKeys: Array<{
            column: string;
            references: { table: string; column: string };
        }>;
        rowCount?: number;
    }>;
};

export const getSchemaSnapshot = async (
    options?: {
        schema?: string;
        includeRowCounts?: boolean;
        tableFilter?: string; // Optional table filter pattern (inclusion)
        excludeFilter?: string; // Optional table exclusion pattern
    }
): Promise<SchemaSnapshot> => {
    const schema = options?.schema ?? 'public';
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL environment variable not found.');
    const sql = neon(process.env.DATABASE_URL);

    // Get table filters from options or environment variables
    const tableFilter = options?.tableFilter ?? process.env.TABLE_FILTER_PATTERN;
    const excludeFilter = options?.excludeFilter ?? process.env.SERVICE_FILTERS;

    // Get all tables from the schema
    const tablesRes = await sql<
        { table_name: string }[]
    >`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = ${schema} AND table_type = 'BASE TABLE'
    ORDER BY table_name
  `;

    let tableNames = tablesRes.map(r => r.table_name);
    const originalCount = tableNames.length;

    // Apply exclusion filter first if specified
    if (excludeFilter) {
        // Support multiple patterns separated by comma
        const excludePatterns = excludeFilter.split(',').map(p => p.trim());
        console.log(`→ Excluding tables matching pattern(s): ${excludePatterns.join(', ')}`);

        // Filter out tables that match exclusion patterns
        tableNames = tableNames.filter(tableName => {
            return !excludePatterns.some(pattern => {
                // Support wildcards: * matches any characters
                // If no wildcard, check if table name contains the pattern
                if (pattern.includes('*')) {
                    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
                    return regex.test(tableName);
                } else {
                    // Simple contains check for service names
                    return tableName.toLowerCase().includes(pattern.toLowerCase());
                }
            });
        });

        const excludedCount = originalCount - tableNames.length;
        if (excludedCount > 0) {
            console.log(`  ✓ Excluded ${excludedCount} table(s)`);
        }
    }

    // Apply inclusion filter if specified
    if (tableFilter) {
        // Support multiple patterns separated by comma
        const patterns = tableFilter.split(',').map(p => p.trim());
        console.log(`→ Including only tables matching pattern(s): ${patterns.join(', ')}`);

        // Filter tables in JavaScript (safer than dynamic SQL)
        tableNames = tableNames.filter(tableName => {
            return patterns.some(pattern => {
                // Support wildcards: * matches any characters
                const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$', 'i');
                return regex.test(tableName);
            });
        });

        if (tableNames.length === 0) {
            console.warn(`⚠️ No tables matched the filter pattern: ${tableFilter}`);
        }
    }

    console.log(`→ Found ${tableNames.length} tables${(tableFilter || excludeFilter) ? ' (filtered)' : ''}: ${tableNames.join(', ')}`);

    const columnsRes = await sql<
        { table_name: string; column_name: string; data_type: string; is_nullable: 'YES' | 'NO'; column_default: string | null }[]
    >`
    SELECT table_name, column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = ${schema}
    ORDER BY table_name, ordinal_position
  `;

    const pkRes = await sql<
        { table_name: string; column_name: string }[]
    >`
    SELECT tc.table_name, kcu.column_name
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    WHERE tc.table_schema = ${schema}
      AND tc.constraint_type = 'PRIMARY KEY'
    ORDER BY tc.table_name, kcu.ordinal_position
  `;

    const fkRes = await sql<
        { fk_table: string; fk_column: string; referenced_table: string; referenced_column: string }[]
    >`
    SELECT
      tc.table_name AS fk_table,
      kcu.column_name AS fk_column,
      ccu.table_name AS referenced_table,
      ccu.column_name AS referenced_column
    FROM information_schema.table_constraints AS tc
    JOIN information_schema.key_column_usage AS kcu
      ON tc.constraint_name = kcu.constraint_name
      AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage AS ccu
      ON ccu.constraint_name = tc.constraint_name
      AND ccu.table_schema = tc.table_schema
    WHERE tc.table_schema = ${schema}
      AND tc.constraint_type = 'FOREIGN KEY'
    ORDER BY fk_table, fk_column
  `;

    const columnsByTable = new Map<string, SchemaSnapshot['tables'][number]['columns']>();
    for (const t of tableNames) columnsByTable.set(t, []);
    for (const r of columnsRes) {
        const arr = columnsByTable.get(r.table_name);
        if (!arr) continue;
        arr.push({
            name: r.column_name,
            type: r.data_type,
            nullable: r.is_nullable === 'YES',
            hasDefault: r.column_default != null
        });
    }

    const pkByTable = new Map<string, string[]>();
    for (const t of tableNames) pkByTable.set(t, []);
    for (const r of pkRes) {
        const arr = pkByTable.get(r.table_name);
        if (!arr) continue;
        arr.push(r.column_name);
    }

    const fkByTable = new Map<string, SchemaSnapshot['tables'][number]['foreignKeys']>();
    for (const t of tableNames) fkByTable.set(t, []);
    for (const r of fkRes) {
        const arr = fkByTable.get(r.fk_table);
        if (!arr) continue;
        arr.push({
            column: r.fk_column,
            references: { table: r.referenced_table, column: r.referenced_column }
        });
    }

    const tables: SchemaSnapshot['tables'] = tableNames.map(name => ({
        name,
        columns: columnsByTable.get(name) ?? [],
        primaryKey: pkByTable.get(name) ?? [],
        foreignKeys: fkByTable.get(name) ?? []
    }));

    if (options?.includeRowCounts) {
        // Simple counts; enable only for small schemas
        await Promise.all(
            tables.map(async t => {
                const res = await sql<{ count: string }[]>(`SELECT COUNT(*)::bigint AS count FROM "${schema}"."${t.name}"`);
                t.rowCount = Number(res[0]?.count ?? 0);
            })
        );
    }

    return { schema, tables };
};

// Optional: keep a tiny CLI for debugging
if (require.main === module) {
    (async () => {
        const snapshot = await getSchemaSnapshot({ includeRowCounts: false });
        console.log(JSON.stringify(snapshot, null, 2));
    })().catch(err => {
        console.error(err);
        process.exit(1);
    });
}
