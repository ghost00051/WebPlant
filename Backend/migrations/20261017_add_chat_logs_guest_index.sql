
CREATE INDEX IF NOT EXISTS idx_chat_logs_guest_token
    ON chat_logs ((metadata ->> 'guestToken'), created_at DESC);
