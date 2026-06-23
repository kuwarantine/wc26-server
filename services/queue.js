import { PgBoss } from 'pg-boss';

const isProd = process.env.NODE_ENV === 'production';
const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    ssl: isProd ? { rejectUnauthorized: false } : false
});

export default boss;

