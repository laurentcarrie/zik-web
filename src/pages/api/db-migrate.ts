import type { APIRoute } from 'astro';
import { neon } from '@netlify/neon';

export const prerender = false;

export const GET: APIRoute = async () => {
    const sql = neon();
    const results: string[] = [];

    try {
        // Add song_yml column to songs table
        await sql`ALTER TABLE songs ADD COLUMN IF NOT EXISTS song_yml TEXT`;
        results.push('✓ Added song_yml column');

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
