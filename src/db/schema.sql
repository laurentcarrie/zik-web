-- Songbook Database Schema

-- Bands/Groups table
CREATE TABLE IF NOT EXISTS bands (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    slug VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    image_url VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Songs table
CREATE TABLE IF NOT EXISTS songs (
    id SERIAL PRIMARY KEY,
    band_id INTEGER REFERENCES bands(id) ON DELETE CASCADE,
    title VARCHAR(255) NOT NULL,
    artist VARCHAR(255),
    tempo INTEGER,
    duration_seconds INTEGER,
    song_yml TEXT
);

-- Concerts/Events table
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
);

-- Setlists table (links songs to concerts with order)
CREATE TABLE IF NOT EXISTS setlists (
    id SERIAL PRIMARY KEY,
    concert_id INTEGER REFERENCES concerts(id) ON DELETE CASCADE,
    song_id INTEGER REFERENCES songs(id) ON DELETE CASCADE,
    position INTEGER NOT NULL,
    notes TEXT,
    UNIQUE(concert_id, position)
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_songs_band_id ON songs(band_id);
CREATE INDEX IF NOT EXISTS idx_concerts_band_id ON concerts(band_id);
CREATE INDEX IF NOT EXISTS idx_concerts_date ON concerts(date);
CREATE INDEX IF NOT EXISTS idx_setlists_concert_id ON setlists(concert_id);
