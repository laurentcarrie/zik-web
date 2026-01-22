use axum::{Form, extract::State, response::Redirect};
use serde::Deserialize;

use crate::AppState;
use crate::song::save_song_yml;

#[derive(Deserialize)]
pub struct SaveYmlForm {
    key: String,
    content: String,
}

pub async fn save_yml(State(state): State<AppState>, Form(form): Form<SaveYmlForm>) -> Redirect {
    match save_song_yml(&state.s3_client, &form.key, &form.content).await {
        Ok(_) => Redirect::to(&format!("/edit-yml?key={}", urlencoding::encode(&form.key))),
        Err(_) => Redirect::to(&format!(
            "/edit-yml?key={}&error=1",
            urlencoding::encode(&form.key)
        )),
    }
}
