import type { APIRoute } from 'astro';
import { sql } from '../../db';

export const prerender = false;

// GET /api/concerts - List all concerts, optionally filtered by band
export const GET: APIRoute = async ({ url }) => {
    const bandSlug = url.searchParams.get('band');

    try {
        let concerts;
        if (bandSlug) {
            concerts = await sql`
                SELECT c.*, b.name as band_name, b.slug as band_slug
                FROM concerts c
                JOIN bands b ON b.id = c.band_id
                WHERE b.slug = ${bandSlug}
                ORDER BY c.date DESC
            `;
        } else {
            concerts = await sql`
                SELECT c.*, b.name as band_name, b.slug as band_slug
                FROM concerts c
                JOIN bands b ON b.id = c.band_id
                ORDER BY c.date DESC
            `;
        }

        return new Response(JSON.stringify({ success: true, concerts }), {
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

// POST /api/concerts - Add a new concert
export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const { band_slug, name, venue, date, time, notes, pdf_url } = body;

        if (!band_slug || !name) {
            return new Response(JSON.stringify({
                success: false,
                error: 'band_slug and name are required'
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

        const [concert] = await sql`
            INSERT INTO concerts (band_id, name, venue, date, time, notes, pdf_url)
            VALUES (${band.id}, ${name}, ${venue || null}, ${date || null}, ${time || null}, ${notes || null}, ${pdf_url || null})
            RETURNING *
        `;

        return new Response(JSON.stringify({ success: true, concert }), {
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

// DELETE /api/concerts?id=123 - Delete a concert
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
        await sql`DELETE FROM concerts WHERE id = ${id}`;

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
