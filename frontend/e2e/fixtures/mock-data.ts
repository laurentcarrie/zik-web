import type { SongDetail } from '../../src/api/types'
import type { ParsedSongStructure } from '../../src/api/songs'

export const SONG_ID = 'test-song-1'

export const mockSongDetail: SongDetail = {
  id: SONG_ID,
  title: 'Smoke On The Water',
  author: 'Deep Purple',
  deezer_url: 'https://www.deezer.com/track/123',
  deezer_app_url: 'deezer://track/123',
  key: 'Gm',
  tempo: 112,
  tags: ['rock', 'classic'],
  mp3_url: '/mtl/static/songs/test-song-1/song.mp3',
  clicks_url: '/mtl/static/songs/test-song-1/clicks.yml',
  mp3_with_clicks_url: '/mtl/static/songs/test-song-1/song-with-click.mp3',
}

export const mockStructure: ParsedSongStructure = {
  sections: [
    {
      id: 'intro',
      title: 'Intro',
      color: 'wheat1',
      rows: [
        {
          bars: [
            { chords: [{ display: 'Gm', font: 'songbook', char: 'r' }] },
            { chords: [{ display: 'Bb', font: 'songbook_flat', char: 'R' }] },
            { chords: [{ display: 'C', font: 'songbook', char: 'T' }] },
            { chords: [{ display: 'Gm', font: 'songbook', char: 'r' }] },
          ],
          repeat: 1,
          bar_number: 1,
        },
      ],
    },
    {
      id: 'verse1',
      title: 'Verse 1',
      color: 'darkseagreen1',
      rows: [
        {
          bars: [
            { chords: [{ display: 'Gm', font: 'songbook', char: 'r' }] },
            { chords: [{ display: 'Gm', font: 'songbook', char: 'r' }] },
            { chords: [{ display: 'Bb', font: 'songbook_flat', char: 'R' }] },
            { chords: [{ display: 'C', font: 'songbook', char: 'T' }] },
          ],
          repeat: 2,
          bar_number: 5,
        },
      ],
    },
    {
      id: 'chorus',
      title: 'Chorus',
      color: 'coral1',
      rows: [
        {
          bars: [
            { chords: [{ display: 'C', font: 'songbook', char: 'T' }] },
            { chords: [{ display: 'Gm', font: 'songbook', char: 'r' }] },
          ],
          repeat: 1,
          bar_number: 13,
        },
      ],
    },
  ],
}

export const mockSongs = [
  { id: 'test-song-0', title: 'Hush', author: 'Deep Purple', deezer_url: '', deezer_app_url: '', key: 'C', tempo: 130, tags: ['rock'] },
  { id: SONG_ID, title: 'Smoke On The Water', author: 'Deep Purple', deezer_url: '', deezer_app_url: '', key: 'Gm', tempo: 112, tags: ['rock', 'classic'] },
  { id: 'test-song-2', title: 'Sultans Of Swing', author: 'Dire Straits', deezer_url: '', deezer_app_url: '', key: 'Dm', tempo: 148, tags: ['rock'] },
]
