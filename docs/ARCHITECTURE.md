# Architecture

- feed_watcher: pulls feed updates
- match_state_store: tracks statuses and transitions
- dedupe_guard: ensures one article per match_id
- news_generator: creates article draft
- publisher: sends to destination
