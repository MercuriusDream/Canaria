
export class SqliteAdapter {
    constructor(private sql: any) { }

    exec(statement: string, params?: unknown[]) {
        this.sql.exec(statement, ...(params || []));
    }

    prepare(statement: string) {
        const sql = this.sql;
        return {
            run: (...params: unknown[]) => {
                sql.exec(statement, ...params);
                return { changes: 1 };
            },
            first: (...params: unknown[]) => {
                const cursor = sql.exec(statement, ...params);
                // Accessing the first element of the iterator
                for (const row of cursor) {
                    return row;
                }
                return null;
            },
            all: (...params: unknown[]) => {
                const cursor = sql.exec(statement, ...params);
                return Array.from(cursor) as Record<string, unknown>[];
            }
        };
    }
}
