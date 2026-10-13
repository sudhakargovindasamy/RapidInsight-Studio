const path = require('path');
const pgPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/pg');
const dotenvPath = path.resolve(__dirname, '../backend/services/schema-service/node_modules/dotenv');
const { Pool } = require(pgPath);
require(dotenvPath).config({ path: path.resolve(__dirname, '../backend/services/schema-service/.env') });

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

async function inspectSchema() {
  const client = await pool.connect();
  try {
    const orgTables = await client.query(`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE '%org%';
    `);
    console.log('Org tables:', orgTables.rows);

    const orgs = await client.query(`
      SELECT id, name, created_by, created_at FROM public.organisations;
    `);
    console.log('Organisations count:', orgs.rows.length);
    console.log('Organisations:', orgs.rows);

    const projects = await client.query(`
      SELECT p.id, p.name, p.created_by, p.organisation_id, o.name as org_name, o.created_by as org_created_by
      FROM public.projects p
      LEFT JOIN public.organisations o ON o.id = p.organisation_id;
    `);
    console.log('Projects count:', projects.rows.length);
    projects.rows.forEach(p => {
      console.log(`Project "${p.name}" (${p.id}) created_by=${p.created_by} | Org "${p.org_name}" created_by=${p.org_created_by}`);
    });
  } finally {
    client.release();
    await pool.end();
  }
}

inspectSchema().catch(console.error);
