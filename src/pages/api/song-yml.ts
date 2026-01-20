import type { APIRoute } from 'astro';
import { sql } from '../../db';

export const prerender = false;

// GET /api/song-yml?title=...&author=...
export const GET: APIRoute = async ({ url }) => {
    const title = url.searchParams.get('title');
    const author = url.searchParams.get('author');

    if (!title) {
        return new Response(JSON.stringify({
            success: false,
            error: 'title parameter is required'
        }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    try {
        let songs;
        if (author) {
            songs = await sql`
                SELECT song_yml FROM songs
                WHERE title = ${title} AND artist = ${author}
                LIMIT 1
            `;
        } else {
            songs = await sql`
                SELECT song_yml FROM songs
                WHERE title = ${title}
                LIMIT 1
            `;
        }

        if (songs.length === 0) {
            return new Response(JSON.stringify({
                success: false,
                error: 'Song not found'
            }), {
                status: 404,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        return new Response(songs[0].song_yml || '', {
            status: 200,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
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
