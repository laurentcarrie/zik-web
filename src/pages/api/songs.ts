import type { APIRoute } from 'astro';
import { sql } from '../../db';

export const prerender = false;

// GET /api/songs - List all songs, optionally filtered by band
export const GET: APIRoute = async ({ url }) => {
    const bandSlug = url.searchParams.get('band');

    try {
        let songs;
        if (bandSlug) {
            songs = await sql`
                SELECT s.*, b.name as band_name, b.slug as band_slug
                FROM songs s
                JOIN bands b ON b.id = s.band_id
                WHERE b.slug = ${bandSlug}
                ORDER BY s.title
            `;
        } else {
            songs = await sql`
                SELECT s.*, b.name as band_name, b.slug as band_slug
                FROM songs s
                JOIN bands b ON b.id = s.band_id
                ORDER BY b.name, s.title
            `;
        }

        return new Response(JSON.stringify({ success: true, songs }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// POST /api/songs - Add a new song
export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { band_slug, title, artist, tempo, duration_seconds, song_yml } = body;

        if (!band_slug || !title) {
            return new Response(JSON.stringify({
                success: false,
                error: 'band_slug and title are required'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Get band ID from slug
        const [band] = await sql`SELECT id FROM bands WHERE slug = ${band_slug}`;
        if (!band) {
            return new Response(JSON.stringify({
                success: false,
                error: `Band not found: ${band_slug}`
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const [song] = await sql`
            INSERT INTO songs (band_id, title, artist, tempo, duration_seconds, song_yml)
            VALUES (${band.id}, ${title}, ${artist || null}, ${tempo || null}, ${duration_seconds || null}, ${song_yml || null})
            RETURNING *
        `;

        return new Response(JSON.stringify({ success: true, song }), {
            status: 201,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// PUT /api/songs - Update a song
export const PUT: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { id, title, artist, tempo, duration_seconds, song_yml } = body;

        if (!id) {
            return new Response(JSON.stringify({
                success: false,
                error: 'id is required'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const [song] = await sql`
            UPDATE songs
            SET title = COALESCE(${title}, title),
                artist = COALESCE(${artist}, artist),
                tempo = COALESCE(${tempo}, tempo),
                duration_seconds = COALESCE(${duration_seconds}, duration_seconds),
                song_yml = COALESCE(${song_yml}, song_yml)
            WHERE id = ${id}
            RETURNING *
        `;

        return new Response(JSON.stringify({ success: true, song }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};

// DELETE /api/songs?id=123 - Delete a song
export const DELETE: APIRoute = async ({ url }) => {
    const id = url.searchParams.get('id');

    if (!id) {
        return new Response(JSON.stringify({
            success: false,
            error: 'id parameter is required'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        await sql`DELETE FROM songs WHERE id = ${id}`;

        return new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { 'Content-Type': 'application/json' }
        });
    } catch (error) {
        return new Response(JSON.stringify({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        });
    }
};
