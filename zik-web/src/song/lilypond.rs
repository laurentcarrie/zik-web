use strudel_of_lilypond::sequencer::model::Pattern;
use strudel_of_lilypond::{LilyPondParser, StrudelGenerator};

pub fn lilypond_to_html(
    input: &str,
    stem: &str,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let parser = LilyPondParser::new();
    let result = parser.parse(input)?;
    let html = StrudelGenerator::generate_html(&result.staves, &result.tempo, stem);
    Ok(html)
}

pub fn drum_pattern_to_html(
    yaml_content: &str,
    name: &str,
    tempo: u32,
) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let pattern: Pattern = serde_yaml::from_str(yaml_content)?;
    let voices: Vec<String> = pattern
        .voices
        .iter()
        .map(|v| format!("    \\new DrumVoice {{ {} }}", v.trim()))
        .collect();
    let lilypond = format!(
        r#"\version "2.24.4"
\score {{
  <<
    \tempo 4 = {tempo}
    \new DrumStaff {{
      <<
{voices}
      >>
    }}
  >>
  \layout {{}}
}}"#,
        tempo = tempo,
        voices = voices.join("\n"),
    );
    lilypond_to_html(&lilypond, name)
}
