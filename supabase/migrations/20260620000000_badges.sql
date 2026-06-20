-- Badges and character_badges tables for the achievements system.

create table if not exists public.badges (
  id                    text        primary key,
  name                  text        not null,
  emoji                 text        not null,
  description           text        not null,
  condition_description text        not null,
  sort_order            integer     not null default 0
);

create table if not exists public.character_badges (
  id            uuid        primary key default gen_random_uuid(),
  character_id  uuid        not null references public.characters(id) on delete cascade,
  badge_id      text        not null references public.badges(id),
  earned_at     timestamptz not null default now(),
  unique (character_id, badge_id)
);

create index if not exists idx_character_badges_character_id on public.character_badges(character_id);

-- RLS
alter table public.badges           enable row level security;
alter table public.character_badges  enable row level security;

create policy "Anyone authenticated can view badges"
  on public.badges for select
  using (auth.uid() is not null);

create policy "Students can view own earned badges"
  on public.character_badges for select
  using (
    exists (
      select 1 from public.characters c
      join public.enrollments e on e.id = c.enrollment_id
      where c.id = character_badges.character_id
        and e.student_id = (select auth.uid())
    )
  );

create policy "Teachers can view badges in their sections"
  on public.character_badges for select
  using (
    exists (
      select 1 from public.characters c
      join public.enrollments e on e.id = c.enrollment_id
      join public.sections s on s.id = e.section_id
      where c.id = character_badges.character_id
        and s.teacher_id = (select auth.uid())
    )
  );

create policy "System can insert character badges"
  on public.character_badges for insert
  with check (
    exists (
      select 1 from public.characters c
      join public.enrollments e on e.id = c.enrollment_id
      where c.id = character_badges.character_id
        and e.student_id = (select auth.uid())
    )
  );

-- Seed badges (matches existing data in Supabase — do not re-run if table already populated)
insert into public.badges (id, name, emoji, description, condition_description, sort_order) values
  ('emergency-fund',    'Emergency Fund',      '🛡️', 'Saved 3 months of expenses.',             'Save enough to cover 3 months of expenses.',      1),
  ('first-investor',    'First Investor',      '📈', 'Made your first investment.',               'Choose to invest when the opportunity appears.',  2),
  ('debt-free',         'Debt Free',           '🎉', 'Paid off all your debt.',                  'Reduce your total debt to $0.',                   3),
  ('perfect-budgeter',  'Perfect Budgeter',    '📊', 'Stayed within budget every week.',         'Stay within your budget for an entire month.',    4),
  ('fully-insured',     'Fully Insured',       '🏥', 'Purchased all available insurance.',       'Buy all available insurance options.',             5),
  ('credit-builder',    'Credit Builder',      '💳', 'Reached a 700+ credit score.',             'Raise your credit score to 700 or higher.',       6),
  ('net-worth-positive','Net Worth Positive',  '💰', 'Reached a positive net worth.',            'Grow your net worth above $0.',                   7)
on conflict (id) do nothing;
