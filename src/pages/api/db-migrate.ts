import type { APIRoute } from 'astro';
import { neon } from '@netlify/neon';

export const prerender = false;

export const GET: APIRoute = async () => {
    const sql = neon();
    const results: string[] = [];

    try {
        // Remove columns from songs table
        await sql`ALTER TABLE songs DROP COLUMN IF EXISTS lyrics`;
        results.push('✓ Dropped lyrics column');

        await sql`ALTER TABLE songs DROP COLUMN IF EXISTS chords`;
        results.push('✓ Dropped chords column');

        await sql`ALTER TABLE songs DROP COLUMN IF EXISTS notes`;
        results.push('✓ Dropped notes column');

        await sql`ALTER TABLE songs DROP COLUMN IF EXISTS strudel_pattern`;
        results.push('✓ Dropped strudel_pattern column');

        await sql`ALTER TABLE songs DROP COLUMN IF EXISTS created_at`;
        results.push('✓ Dropped created_at column');

        await sql`ALTER TABLE songs DROP COLUMN IF EXISTS updated_at`;
        results.push('✓ Dropped updated_at column');

        return new Response(JSON.stringify({
            success: true,
            message: 'Migration complete!',
            results
        }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });

    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
            results
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
