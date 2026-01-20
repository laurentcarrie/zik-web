import { neon } from '@netlify/neon';

// Create a singleton database connection
export const sql = neon();

// Type definitions for your tables
export interface Band {
    id: number;
    name: string;
    slug: string;
    description: string | null;
    image_url: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface Song {
    id: number;
    band_id: number;
    title: string;
    artist: string | null;
    key: string | null;
    tempo: number | null;
    duration_seconds: number | null;
}

export interface Concert {
    id: number;
    band_id: number;
    name: string;
    venue: string | null;
    date: Date | null;
    time: string | null;
    notes: string | null;
    pdf_url: string | null;
    created_at: Date;
    updated_at: Date;
}

export interface SetlistItem {
    id: number;
    concert_id: number;
    song_id: number;
    position: number;
    notes: string | null;
}

// Helper functions for common queries

export async function getBands(): Promise<Band[]> {
    return sql`SELECT * FROM bands ORDER BY name`;
}

export async function getBandBySlug(slug: string): Promise<Band | null> {
    const [band] = await sql`SELECT * FROM bands WHERE slug = ${slug}`;
    return band || null;
}

export async function getSongsByBand(bandId: number): Promise<Song[]> {
    return sql`SELECT * FROM songs WHERE band_id = ${bandId} ORDER BY title`;
}

export async function getConcertsByBand(bandId: number): Promise<Concert[]> {
    return sql`SELECT * FROM concerts WHERE band_id = ${bandId} ORDER BY date DESC`;
}

export async function getSetlist(concertId: number): Promise<(SetlistItem & { song: Song })[]> {
    return sql`
        SELECT s.*, row_to_json(songs.*) as song
        FROM setlists s
        JOIN songs ON songs.id = s.song_id
        WHERE s.concert_id = ${concertId}
        ORDER BY s.position
    `;
}
