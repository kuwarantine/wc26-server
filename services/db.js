import postgres from 'postgres';

const isProd = process.env.NODE_ENV === 'production';
const sql = postgres(process.env.DATABASE_URL, {
    ssl: isProd ? { rejectUnauthorized: false } : false
});

// Generic function to insert data to DB
export async function insertData(table, data, ignoreConflicts = false ) {
    try {
        await sql`INSERT INTO ${ sql(table) } ${ sql(data) }
                  ${ ignoreConflicts ? sql`ON CONFLICT DO NOTHING` : sql`` }`;
    } catch (err) {
        console.error(`Inserting into ${table} failed:`, err.message);
    }
}

export default sql;