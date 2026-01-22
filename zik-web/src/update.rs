use axum::extract::State;

use crate::AppState;
use crate::song::write_all_songs_to_s3;

pub async fn update(State(state): State<AppState>) -> String {
    match write_all_songs_to_s3(&state.s3_client).await {
        Ok(_) => "Updated".to_string(),
        Err(e) => format!("Error: {e:?}"),
    }
}
