import { neon } from '@netlify/neon';

const sql = neon();

async function setup() {
    console.log('Setting up database schema...');

    // Create bands table
    await sql`
        CREATE TABLE IF NOT EXISTS bands (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL UNIQUE,
            slug VARCHAR(255) NOT NULL UNIQUE,
            description TEXT,
            image_url VARCHAR(500),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `;
    console.log('✓ Created bands table');

    // Create songs table
    await sql`
        CREATE TABLE IF NOT EXISTS songs (
            id SERIAL PRIMARY KEY,
            band_id INTEGER REFERENCES bands(id) ON DELETE CASCADE,
            title VARCHAR(255) NOT NULL,
            artist VARCHAR(255),
            key VARCHAR(10),
            tempo INTEGER,
            duration_seconds INTEGER,
            lyrics TEXT,
            chords TEXT,
            notes TEXT,
            strudel_pattern TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `;
    console.log('✓ Created songs table');

    // Create concerts table
    await sql`
        CREATE TABLE IF NOT EXISTS concerts (
            id SERIAL PRIMARY KEY,
            band_id INTEGER REFERENCES bands(id) ON DELETE CASCADE,
            name VARCHAR(255) NOT NULL,
            venue VARCHAR(255),
            date DATE,
            time TIME,
            notes TEXT,
            pdf_url VARCHAR(500),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `;
    console.log('✓ Created concerts table');

    // Create setlists table
    await sql`
        CREATE TABLE IF NOT EXISTS setlists (
            id SERIAL PRIMARY KEY,
            concert_id INTEGER REFERENCES concerts(id) ON DELETE CASCADE,
            song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            notes TEXT,
            UNIQUE(concert_id, position)
        )
    `;
    console.log('✓ Created setlists table');

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_songs_band_id ON songs(band_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_concerts_band_id ON concerts(band_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_concerts_date ON concerts(date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_setlists_concert_id ON setlists(concert_id)`;
    console.log('✓ Created indexes');

    // Insert initial data for your existing bands
    await sql`
        INSERT INTO bands (name, slug, image_url)
        VALUES
            ('Move The Line', 'move-the-line', '/images/Move-the-line-affiche.jpg'),
            ('Sunny Bd', 'sunny-bd', '/images/sunny-bd.jpg')
        ON CONFLICT (slug) DO NOTHING
    `;
    console.log('✓ Inserted initial bands');

    console.log('\n✅ Database setup complete!');
}

setup().catch(console.error);
