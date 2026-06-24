-- Add ai_feedback column to student_decisions for storing
-- Claude-generated personalized feedback on decisions.
alter table public.student_decisions
  add column if not exists ai_feedback text;
