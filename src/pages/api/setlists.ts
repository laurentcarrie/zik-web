import type { APIRoute } from 'astro';
import { sql } from '../../db';

export const prerender = false;

// GET /api/setlists?concert_id=123 - Get setlist for a concert
export const GET: APIRoute = async ({ url }) => {
    const concertId = url.searchParams.get('concert_id');

    if (!concertId) {
        return new Response(JSON.stringify({
            success: false,
            error: 'concert_id parameter is required'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        const setlist = await sql`
            SELECT sl.*, s.title, s.artist, s.key, s.tempo
            FROM setlists sl
            JOIN songs s ON s.id = sl.song_id
            WHERE sl.concert_id = ${concertId}
            ORDER BY sl.position
        `;

        return new Response(JSON.stringify({ success: true, setlist }), {
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

// POST /api/setlists - Add a song to a setlist
export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { concert_id, song_id, position, notes } = body;

        if (!concert_id || !song_id || position === undefined) {
            return new Response(JSON.stringify({
                success: false,
                error: 'concert_id, song_id, and position are required'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        const [item] = await sql`
            INSERT INTO setlists (concert_id, song_id, position, notes)
            VALUES (${concert_id}, ${song_id}, ${position}, ${notes || null})
            RETURNING *
        `;

        return new Response(JSON.stringify({ success: true, item }), {
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

// PUT /api/setlists - Update setlist positions (bulk update)
export const PUT: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { concert_id, items } = body;

        if (!concert_id || !items || !Array.isArray(items)) {
            return new Response(JSON.stringify({
                success: false,
                error: 'concert_id and items array are required'
            }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        // Delete existing setlist and recreate
        await sql`DELETE FROM setlists WHERE concert_id = ${concert_id}`;

        for (const item of items) {
            await sql`
                INSERT INTO setlists (concert_id, song_id, position, notes)
                VALUES (${concert_id}, ${item.song_id}, ${item.position}, ${item.notes || null})
            `;
        }

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

// DELETE /api/setlists?id=123 - Remove a song from setlist
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
        await sql`DELETE FROM setlists WHERE id = ${id}`;

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
