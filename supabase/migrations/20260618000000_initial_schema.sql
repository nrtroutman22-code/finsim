-- FinSim Initial Schema
-- Personal finance simulation for high school classes
-- Supabase (PostgreSQL) + Supabase Auth
--
-- Safe to re-run: drops everything first, then recreates.

-- ============================================================
-- CLEAN SLATE: drop everything in dependency order
-- ============================================================

-- Trigger on auth.users (not dropped by table drops below)
drop trigger if exists on_auth_user_created on auth.users;

-- Tables: children first, parents last
drop table if exists public.grades              cascade;
drop table if exists public.student_decisions   cascade;
drop table if exists public.financial_states    cascade;
drop table if exists public.section_life_events cascade;
drop table if exists public.decision_options    cascade;
drop table if exists public.life_event_options  cascade;
drop table if exists public.characters          cascade;
drop table if exists public.enrollments         cascade;
drop table if exists public.sections            cascade;
drop table if exists public.weeks               cascade;
drop table if exists public.life_events         cascade;
drop table if exists public.locations           cascade;
drop table if exists public.life_paths          cascade;
drop table if exists public.profiles            cascade;

-- Functions
drop function if exists public.join_section_by_invite(uuid);
drop function if exists public.join_section_by_code(text);
drop function if exists public.teacher_owns_character_section(uuid);
drop function if exists public.student_owns_character(uuid);
drop function if exists public.teacher_owns_section(uuid);
drop function if exists public.is_student();
drop function if exists public.is_teacher();
drop function if exists public.handle_new_user();
drop function if exists public.update_updated_at();

-- ============================================================
-- FUNCTIONS
-- ============================================================

create or replace function public.update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, role, display_name, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'role', 'student'),
    coalesce(
      new.raw_user_meta_data->>'display_name',
      new.raw_user_meta_data->>'full_name',
      split_part(new.email, '@', 1)
    ),
    new.email
  );
  return new;
end;
$$ language plpgsql security definer;

-- ============================================================
-- TABLE 1: profiles
-- ============================================================

create table if not exists public.profiles (
  id            uuid        primary key references auth.users(id) on delete cascade,
  role          text        not null check (role in ('teacher', 'student')),
  display_name  text        not null,
  email         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.update_updated_at();

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- TABLE 2: sections
-- ============================================================

create table if not exists public.sections (
  id                    uuid        primary key default gen_random_uuid(),
  teacher_id            uuid        not null references public.profiles(id) on delete cascade,
  name                  text        not null,
  class_code            text        not null unique,
  invite_link_token     uuid        not null unique default gen_random_uuid(),
  unlocked_week         integer     not null default 0,
  unlocked_categories   text[]      not null default '{}',
  is_active             boolean     not null default true,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create trigger sections_updated_at
  before update on public.sections
  for each row execute function public.update_updated_at();

-- ============================================================
-- TABLE 3: enrollments
-- ============================================================

create table if not exists public.enrollments (
  id                    uuid        primary key default gen_random_uuid(),
  student_id            uuid        not null references public.profiles(id) on delete cascade,
  section_id            uuid        not null references public.sections(id) on delete cascade,
  status                text        not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  join_method           text        not null check (join_method in ('class_code', 'invite_link')),
  deactivation_reason   text,
  dashboard_shared      boolean     not null default false,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  unique (student_id, section_id)
);

create trigger enrollments_updated_at
  before update on public.enrollments
  for each row execute function public.update_updated_at();

-- ============================================================
-- TABLE 4: life_paths (reference)
-- ============================================================

create table if not exists public.life_paths (
  id                        text      primary key,
  name                      text      not null,
  description               text,
  starting_monthly_income    numeric   not null default 0,
  starting_cash              numeric   not null default 0,
  starting_savings           numeric   not null default 0,
  starting_debt              numeric   not null default 0,
  starting_credit_score      integer   not null default 650,
  sort_order                 integer   not null default 0
);

-- ============================================================
-- TABLE 5: locations (reference)
-- ============================================================

create table if not exists public.locations (
  id                      text      primary key,
  name                    text      not null,
  description             text,
  cost_of_living_modifier numeric   not null default 1.0,
  sort_order              integer   not null default 0
);

-- ============================================================
-- TABLE 6: characters
-- ============================================================

create table if not exists public.characters (
  id                uuid        primary key default gen_random_uuid(),
  enrollment_id     uuid        not null unique references public.enrollments(id) on delete cascade,
  name              text        not null,
  emoji             text        not null,
  skin_tone         text        not null,
  background_color  text        not null,
  life_path_id      text        not null references public.life_paths(id),
  location_id       text        not null references public.locations(id),
  money_personality jsonb       not null,
  current_week      integer     not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create trigger characters_updated_at
  before update on public.characters
  for each row execute function public.update_updated_at();

-- ============================================================
-- TABLE 7: financial_states
-- ============================================================

create table if not exists public.financial_states (
  id                uuid        primary key default gen_random_uuid(),
  character_id      uuid        not null references public.characters(id) on delete cascade,
  week              integer     not null,
  net_worth         numeric     not null default 0,
  cash              numeric     not null default 0,
  monthly_income    numeric     not null default 0,
  monthly_expenses  numeric     not null default 0,
  savings           numeric     not null default 0,
  debt              numeric     not null default 0,
  credit_score      integer     not null default 650,
  created_at        timestamptz not null default now(),

  unique (character_id, week)
);

-- ============================================================
-- TABLE 8: weeks (reference)
-- ============================================================

create table if not exists public.weeks (
  id            uuid    primary key default gen_random_uuid(),
  week_number   integer not null unique,
  title         text    not null,
  description   text,
  category      text    not null check (category in ('budgeting', 'debt', 'savings', 'investing'))
);

-- ============================================================
-- TABLE 9: decision_options
-- ============================================================

create table if not exists public.decision_options (
  id                uuid    primary key default gen_random_uuid(),
  week_id           uuid    not null references public.weeks(id) on delete cascade,
  label             text    not null,
  description       text,
  financial_impact  jsonb   not null,
  sort_order        integer not null default 0
);

-- ============================================================
-- TABLE 10: life_events (reference)
-- ============================================================

create table if not exists public.life_events (
  id            uuid    primary key default gen_random_uuid(),
  title         text    not null,
  description   text,
  category      text    not null check (category in ('budgeting', 'debt', 'savings', 'investing')),
  is_positive   boolean not null default false
);

-- ============================================================
-- TABLE 11: life_event_options
-- ============================================================

create table if not exists public.life_event_options (
  id                uuid    primary key default gen_random_uuid(),
  life_event_id     uuid    not null references public.life_events(id) on delete cascade,
  label             text    not null,
  description       text,
  financial_impact  jsonb   not null,
  sort_order        integer not null default 0
);

-- ============================================================
-- TABLE 12: section_life_events
-- ============================================================

create table if not exists public.section_life_events (
  id              uuid        primary key default gen_random_uuid(),
  section_id      uuid        not null references public.sections(id) on delete cascade,
  life_event_id   uuid        not null references public.life_events(id) on delete cascade,
  week            integer     not null,
  triggered_at    timestamptz not null default now(),

  unique (section_id, life_event_id, week)
);

-- ============================================================
-- TABLE 13: student_decisions
-- ============================================================

create table if not exists public.student_decisions (
  id                      uuid        primary key default gen_random_uuid(),
  character_id            uuid        not null references public.characters(id) on delete cascade,
  week                    integer     not null,
  decision_type           text        not null check (decision_type in ('curriculum', 'life_event')),
  decision_option_id      uuid        references public.decision_options(id) on delete set null,
  life_event_option_id    uuid        references public.life_event_options(id) on delete set null,
  created_at              timestamptz not null default now(),

  unique (character_id, week, decision_type),

  constraint one_option_set check (
    (decision_type = 'curriculum'  and decision_option_id   is not null and life_event_option_id is null) or
    (decision_type = 'life_event'  and life_event_option_id is not null and decision_option_id   is null)
  )
);

-- ============================================================
-- TABLE 14: grades
-- ============================================================

create table if not exists public.grades (
  id            uuid        primary key default gen_random_uuid(),
  character_id  uuid        not null references public.characters(id) on delete cascade,
  category      text        not null check (category in ('budgeting', 'debt', 'savings', 'investing')),
  auto_grade    numeric     not null default 0,
  manual_grade  numeric,
  feedback      text,
  updated_at    timestamptz not null default now(),

  unique (character_id, category)
);

create trigger grades_updated_at
  before update on public.grades
  for each row execute function public.update_updated_at();

-- ============================================================
-- INDEXES
-- ============================================================

create index if not exists idx_sections_teacher_id           on public.sections(teacher_id);
create index if not exists idx_enrollments_student_id        on public.enrollments(student_id);
create index if not exists idx_enrollments_section_id        on public.enrollments(section_id);
create index if not exists idx_enrollments_status            on public.enrollments(status);
create index if not exists idx_financial_states_character_id  on public.financial_states(character_id);
create index if not exists idx_student_decisions_character_id on public.student_decisions(character_id);
create index if not exists idx_decision_options_week_id       on public.decision_options(week_id);
create index if not exists idx_life_event_options_event_id    on public.life_event_options(life_event_id);
create index if not exists idx_section_life_events_section    on public.section_life_events(section_id);
create index if not exists idx_grades_character_id            on public.grades(character_id);

-- ============================================================
-- SEED DATA: life_paths
-- ============================================================

insert into public.life_paths (id, name, description, starting_monthly_income, starting_cash, starting_savings, starting_debt, starting_credit_score, sort_order) values
  ('four-year-college',  'Four-Year College Graduate',  'Earned a bachelor''s degree. Solid earning potential but carrying student loan debt.',                   3500, 500,  200,  35000, 680, 1),
  ('community-college',  'Community College Graduate',   'Completed a two-year degree. Lower debt than a four-year school with decent job prospects.',            2800, 800,  500,  12000, 670, 2),
  ('trade-school',       'Trade School Graduate',        'Learned a skilled trade like welding, plumbing, or electrical. In-demand skills with moderate debt.',   3200, 1000, 800,  15000, 690, 3),
  ('tech-bootcamp',      'Tech Bootcamp Graduate',       'Completed an intensive coding bootcamp. High earning potential in tech.',                               3800, 600,  300,  18000, 660, 4),
  ('military',           'Military Veteran',             'Served in the armed forces. Disciplined saving habits and veterans'' benefits.',                        2600, 2000, 3000, 0,     710, 5),
  ('apprenticeship',     'Apprenticeship Graduate',      'Learned on the job through a formal apprenticeship program. Earned while you learned.',                 2900, 1200, 1500, 2000,  700, 6),
  ('straight-to-work',   'Straight to Work',             'Entered the workforce right after high school. No student debt but lower starting income.',             2200, 1500, 1000, 3000,  650, 7),
  ('entrepreneur',       'Entrepreneur',                 'Started your own small business. Income varies but you''re building something of your own.',            2000, 800,  500,  10000, 640, 8),
  ('gap-year',           'Gap Year Explorer',            'Took time to travel and figure things out. Less savings but more life experience.',                     2000, 300,  100,  5000,  620, 9),
  ('family-business',    'Family Business',              'Joined the family business. Steady work with some inherited business debt.',                            2500, 1000, 2000, 8000,  670, 10)
on conflict (id) do nothing;

-- ============================================================
-- SEED DATA: locations
-- ============================================================

insert into public.locations (id, name, description, cost_of_living_modifier, sort_order) values
  ('big-city',   'Big City',   'A major metro area like NYC, LA, or Chicago. Lots of opportunities but everything costs more.',  1.40, 1),
  ('suburb',     'Suburb',     'A suburban area outside a mid-size city. A balance of access and affordability.',                 1.10, 2),
  ('small-town', 'Small Town', 'A smaller community with lower costs. Fewer job options but your money goes further.',           0.85, 3),
  ('rural',      'Rural Area', 'Out in the country. Very affordable living but limited job market and services.',                0.70, 4)
on conflict (id) do nothing;

-- ============================================================
-- SEED DATA: life_events + life_event_options
-- ============================================================

do $$
declare
  ev_car_breakdown     uuid;
  ev_job_promotion     uuid;
  ev_roommate_leaves   uuid;
  ev_hours_cut         uuid;
  ev_identity_theft    uuid;
  ev_medical_bill      uuid;
  ev_tax_refund        uuid;
  ev_inheritance       uuid;
  ev_pet_emergency     uuid;
  ev_market_dip        uuid;
  ev_employer_401k     uuid;
  ev_side_hustle       uuid;
begin

  -- 1. Car Breakdown (budgeting, negative)
  insert into public.life_events (title, description, category, is_positive)
  values ('Car Breakdown', 'Your car won''t start and the mechanic says it needs major repairs.', 'budgeting', false)
  returning id into ev_car_breakdown;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_car_breakdown, 'Pay cash for repairs',        'Drain your cash to fix the car now.',                    '{"cash": -1200}', 1),
    (ev_car_breakdown, 'Put it on a credit card',     'No cash hit now, but you''ll owe more with interest.',   '{"debt": 1500, "credit_score": -15}', 2),
    (ev_car_breakdown, 'Buy a cheap used car instead', 'Spend more upfront but lower future maintenance.',      '{"cash": -3000, "monthly_expenses": -50}', 3);

  -- 2. Job Promotion (budgeting, positive)
  insert into public.life_events (title, description, category, is_positive)
  values ('Job Promotion', 'Your boss is impressed with your work and offers you a promotion with a raise!', 'budgeting', true)
  returning id into ev_job_promotion;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_job_promotion, 'Accept the promotion',       'More pay but longer hours and commute costs.',            '{"monthly_income": 600, "monthly_expenses": 100}', 1),
    (ev_job_promotion, 'Negotiate flexible schedule', 'Smaller raise but save on commute and childcare.',       '{"monthly_income": 300, "monthly_expenses": -50}', 2),
    (ev_job_promotion, 'Decline politely',            'Keep your current work-life balance. No financial change.', '{}', 3);

  -- 3. Roommate Moves Out (budgeting, negative)
  insert into public.life_events (title, description, category, is_positive)
  values ('Roommate Moves Out', 'Your roommate is moving to another city. You need to figure out rent.', 'budgeting', false)
  returning id into ev_roommate_leaves;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_roommate_leaves, 'Cover the full rent yourself', 'You can handle it, but it''s a big hit to your budget.', '{"monthly_expenses": 500}', 1),
    (ev_roommate_leaves, 'Find a new roommate fast',     'Post online and find someone within the month.',         '{"monthly_expenses": 100}', 2),
    (ev_roommate_leaves, 'Move to a cheaper place',      'Pay moving costs now but save on rent long-term.',       '{"cash": -800, "monthly_expenses": -200}', 3);

  -- 4. Hours Cut at Work (budgeting, negative)
  insert into public.life_events (title, description, category, is_positive)
  values ('Hours Cut at Work', 'Your employer is cutting hours due to a slow season. Your paycheck will shrink.', 'budgeting', false)
  returning id into ev_hours_cut;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_hours_cut, 'Pick up a side gig',    'Drive rideshare or deliver food to make up the difference.', '{"monthly_income": -200, "monthly_expenses": 100}', 1),
    (ev_hours_cut, 'Tighten your budget',   'Cut subscriptions and eating out to get by.',                '{"monthly_income": -400, "monthly_expenses": -300}', 2),
    (ev_hours_cut, 'Dip into savings',      'Use savings to cover the gap for now.',                      '{"monthly_income": -400, "savings": -1000}', 3);

  -- 5. Identity Theft (debt, negative)
  insert into public.life_events (title, description, category, is_positive)
  values ('Identity Theft', 'Someone opened a credit card in your name! You notice fraudulent charges on your credit report.', 'debt', false)
  returning id into ev_identity_theft;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_identity_theft, 'Freeze credit and dispute', 'File a report and freeze your credit. Takes time but costs nothing.', '{"credit_score": -50}', 1),
    (ev_identity_theft, 'Pay for identity protection', 'Subscribe to a monitoring service for peace of mind.',              '{"monthly_expenses": 30, "credit_score": -20}', 2);

  -- 6. Medical Bill (debt, negative)
  insert into public.life_events (title, description, category, is_positive)
  values ('Unexpected Medical Bill', 'You had an ER visit and the bill just arrived. It''s more than you expected.', 'debt', false)
  returning id into ev_medical_bill;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_medical_bill, 'Pay the full bill now',      'Use your cash to pay it off and avoid interest.',       '{"cash": -1500}', 1),
    (ev_medical_bill, 'Set up a payment plan',      'Spread it over 6 months. Manageable but adds to bills.', '{"monthly_expenses": 275}', 2),
    (ev_medical_bill, 'Negotiate the bill down',    'Call and ask for a discount. Hospitals often reduce bills if you ask.', '{"cash": -800}', 3);

  -- 7. Tax Refund (savings, positive)
  insert into public.life_events (title, description, category, is_positive)
  values ('Tax Refund', 'You filed your taxes and you''re getting a refund! What will you do with it?', 'savings', true)
  returning id into ev_tax_refund;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_tax_refund, 'Put it all in savings',        'Grow your emergency fund.',                              '{"savings": 1500}', 1),
    (ev_tax_refund, 'Save some, spend some',        'Treat yourself a little and save the rest.',              '{"savings": 800, "cash": 700}', 2),
    (ev_tax_refund, 'Pay down debt',                'Knock out some of what you owe and boost your score.',   '{"debt": -1500, "credit_score": 10}', 3);

  -- 8. Unexpected Inheritance (savings, positive)
  insert into public.life_events (title, description, category, is_positive)
  values ('Unexpected Inheritance', 'A distant relative left you some money in their will.', 'savings', true)
  returning id into ev_inheritance;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_inheritance, 'Save it all',          'Put the entire amount into your savings account.',          '{"savings": 5000}', 1),
    (ev_inheritance, 'Pay off debt',         'Use the windfall to eliminate what you owe.',               '{"debt": -5000, "credit_score": 20}', 2),
    (ev_inheritance, 'Split between goals',  'Half to savings, half to pay down debt.',                   '{"savings": 2500, "debt": -2500, "credit_score": 10}', 3);

  -- 9. Pet Emergency (savings, negative)
  insert into public.life_events (title, description, category, is_positive)
  values ('Pet Emergency', 'Your pet ate something it shouldn''t have and needs emergency vet surgery.', 'savings', false)
  returning id into ev_pet_emergency;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_pet_emergency, 'Pay from savings',         'Your emergency fund covers it, but it hurts.',           '{"savings": -2000}', 1),
    (ev_pet_emergency, 'Put it on a credit card',  'Save your cash but take on high-interest debt.',         '{"debt": 2500, "credit_score": -10}', 2),
    (ev_pet_emergency, 'Set up a payment plan with the vet', 'Spread the cost over several months.',         '{"monthly_expenses": 200}', 3);

  -- 10. Stock Market Dip (investing, negative)
  insert into public.life_events (title, description, category, is_positive)
  values ('Stock Market Dip', 'The stock market just dropped 15%. Your investments lost value. What do you do?', 'investing', false)
  returning id into ev_market_dip;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_market_dip, 'Sell to stop losses',         'Lock in your losses but protect what''s left.',           '{"savings": -1000}', 1),
    (ev_market_dip, 'Hold steady',                 'Markets recover over time. Stay the course.',             '{}', 2),
    (ev_market_dip, 'Buy more while it''s low',    'Invest extra cash while prices are cheap.',               '{"cash": -500, "savings": 300}', 3);

  -- 11. Employer 401(k) Match (investing, positive)
  insert into public.life_events (title, description, category, is_positive)
  values ('Employer 401(k) Match', 'Your employer is now offering to match your retirement contributions up to 5%.', 'investing', true)
  returning id into ev_employer_401k;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_employer_401k, 'Contribute the full 5%',   'Get the full match — it''s free money for your future.',  '{"monthly_income": -200, "savings": 400}', 1),
    (ev_employer_401k, 'Contribute 2%',            'Get a partial match. Smaller hit to your paycheck.',      '{"monthly_income": -80, "savings": 160}', 2),
    (ev_employer_401k, 'Skip it for now',          'Keep your full paycheck. You''ll invest later... maybe.',  '{}', 3);

  -- 12. Side Hustle Takes Off (investing, positive)
  insert into public.life_events (title, description, category, is_positive)
  values ('Side Hustle Takes Off', 'The online store you started is getting real orders. Time to decide how serious you are.', 'investing', true)
  returning id into ev_side_hustle;

  insert into public.life_event_options (life_event_id, label, description, financial_impact, sort_order) values
    (ev_side_hustle, 'Go all in',              'Invest cash to grow the business. Higher risk, higher reward.', '{"cash": -1500, "monthly_income": 800, "monthly_expenses": 200}', 1),
    (ev_side_hustle, 'Keep it casual',         'Don''t invest more — just pocket the extra income.',            '{"monthly_income": 300}', 2),
    (ev_side_hustle, 'Sell it',                'Someone offered to buy your store. Take the cash and move on.', '{"cash": 3000}', 3);

end;
$$;

-- ============================================================
-- RLS HELPER FUNCTIONS
-- ============================================================

create or replace function public.is_teacher()
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'teacher'
  );
$$;

create or replace function public.is_student()
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'student'
  );
$$;

create or replace function public.teacher_owns_section(p_section_id uuid)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.sections
    where id = p_section_id and teacher_id = auth.uid()
  );
$$;

create or replace function public.student_owns_character(p_character_id uuid)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.characters c
    join public.enrollments e on e.id = c.enrollment_id
    where c.id = p_character_id
      and e.student_id = auth.uid()
      and e.status = 'approved'
  );
$$;

create or replace function public.teacher_owns_character_section(p_character_id uuid)
returns boolean
language sql security definer stable
as $$
  select exists (
    select 1 from public.characters c
    join public.enrollments e on e.id = c.enrollment_id
    join public.sections s on s.id = e.section_id
    where c.id = p_character_id
      and s.teacher_id = auth.uid()
  );
$$;

-- ============================================================
-- ENABLE RLS ON ALL TABLES
-- ============================================================

alter table public.profiles            enable row level security;
alter table public.sections            enable row level security;
alter table public.enrollments         enable row level security;
alter table public.life_paths          enable row level security;
alter table public.locations           enable row level security;
alter table public.characters          enable row level security;
alter table public.financial_states    enable row level security;
alter table public.weeks               enable row level security;
alter table public.decision_options    enable row level security;
alter table public.life_events         enable row level security;
alter table public.life_event_options  enable row level security;
alter table public.section_life_events enable row level security;
alter table public.student_decisions   enable row level security;
alter table public.grades              enable row level security;

-- ============================================================
-- RLS: profiles
-- ============================================================

create policy "Users can view own profile"
  on public.profiles for select
  using (id = (select auth.uid()));

create policy "Teachers can view student profiles in their sections"
  on public.profiles for select
  using (
    public.is_teacher()
    and exists (
      select 1 from public.enrollments e
      join public.sections s on s.id = e.section_id
      where e.student_id = profiles.id
        and s.teacher_id = (select auth.uid())
    )
  );

create policy "Students can view their teachers profiles"
  on public.profiles for select
  using (
    public.is_student()
    and profiles.role = 'teacher'
    and exists (
      select 1 from public.sections s
      join public.enrollments e on e.section_id = s.id
      where s.teacher_id = profiles.id
        and e.student_id = (select auth.uid())
    )
  );

create policy "Users can update own profile"
  on public.profiles for update
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- ============================================================
-- RLS: sections
-- ============================================================

create policy "Teachers can view own sections"
  on public.sections for select
  using (teacher_id = (select auth.uid()));

create policy "Students can view sections they are enrolled in"
  on public.sections for select
  using (
    exists (
      select 1 from public.enrollments
      where enrollments.section_id = sections.id
        and enrollments.student_id = (select auth.uid())
    )
  );

create policy "Teachers can create sections"
  on public.sections for insert
  with check (
    teacher_id = (select auth.uid())
    and public.is_teacher()
  );

create policy "Teachers can update own sections"
  on public.sections for update
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

create policy "Teachers can delete own sections"
  on public.sections for delete
  using (teacher_id = (select auth.uid()));

-- ============================================================
-- RLS: enrollments
-- ============================================================

create policy "Students can view own enrollments"
  on public.enrollments for select
  using (student_id = (select auth.uid()));

create policy "Teachers can view enrollments in their sections"
  on public.enrollments for select
  using (public.teacher_owns_section(section_id));

create policy "Students can request to join a section"
  on public.enrollments for insert
  with check (
    student_id = (select auth.uid())
    and status = 'pending'
    and public.is_student()
  );

create policy "Teachers can update enrollments in their sections"
  on public.enrollments for update
  using (public.teacher_owns_section(section_id))
  with check (public.teacher_owns_section(section_id));

create policy "Teachers can delete enrollments in their sections"
  on public.enrollments for delete
  using (public.teacher_owns_section(section_id));

-- ============================================================
-- RLS: reference tables (read-only for all authenticated users)
-- ============================================================

create policy "Authenticated users can view life paths"
  on public.life_paths for select
  using ((select auth.uid()) is not null);

create policy "Authenticated users can view locations"
  on public.locations for select
  using ((select auth.uid()) is not null);

create policy "Authenticated users can view weeks"
  on public.weeks for select
  using ((select auth.uid()) is not null);

create policy "Authenticated users can view decision options"
  on public.decision_options for select
  using ((select auth.uid()) is not null);

create policy "Authenticated users can view life events"
  on public.life_events for select
  using ((select auth.uid()) is not null);

create policy "Authenticated users can view life event options"
  on public.life_event_options for select
  using ((select auth.uid()) is not null);

-- ============================================================
-- RLS: characters
-- ============================================================

create policy "Students can view own character"
  on public.characters for select
  using (
    exists (
      select 1 from public.enrollments
      where enrollments.id = characters.enrollment_id
        and enrollments.student_id = (select auth.uid())
        and enrollments.status = 'approved'
    )
  );

create policy "Teachers can view characters in their sections"
  on public.characters for select
  using (
    exists (
      select 1 from public.enrollments e
      join public.sections s on s.id = e.section_id
      where e.id = characters.enrollment_id
        and s.teacher_id = (select auth.uid())
    )
  );

create policy "Students can create character for approved enrollment"
  on public.characters for insert
  with check (
    exists (
      select 1 from public.enrollments
      where enrollments.id = enrollment_id
        and enrollments.student_id = (select auth.uid())
        and enrollments.status = 'approved'
    )
  );

create policy "Students can update own character"
  on public.characters for update
  using (
    exists (
      select 1 from public.enrollments
      where enrollments.id = characters.enrollment_id
        and enrollments.student_id = (select auth.uid())
        and enrollments.status = 'approved'
    )
  );

-- ============================================================
-- RLS: financial_states
-- ============================================================
-- No UPDATE or DELETE — permanent weekly snapshots.

create policy "Students can view own financial states"
  on public.financial_states for select
  using (public.student_owns_character(character_id));

create policy "Teachers can view financial states in their sections"
  on public.financial_states for select
  using (public.teacher_owns_character_section(character_id));

create policy "Students can create financial states for own character"
  on public.financial_states for insert
  with check (public.student_owns_character(character_id));

-- ============================================================
-- RLS: section_life_events
-- ============================================================

create policy "Teachers can view life events for their sections"
  on public.section_life_events for select
  using (public.teacher_owns_section(section_id));

create policy "Approved students can view life events for their section"
  on public.section_life_events for select
  using (
    exists (
      select 1 from public.enrollments
      where enrollments.section_id = section_life_events.section_id
        and enrollments.student_id = (select auth.uid())
        and enrollments.status = 'approved'
    )
  );

create policy "Teachers can trigger life events for their sections"
  on public.section_life_events for insert
  with check (public.teacher_owns_section(section_id));

create policy "Teachers can remove life events from their sections"
  on public.section_life_events for delete
  using (public.teacher_owns_section(section_id));

-- ============================================================
-- RLS: student_decisions
-- ============================================================
-- No UPDATE or DELETE — decisions are permanent history.

create policy "Students can view own decisions"
  on public.student_decisions for select
  using (public.student_owns_character(character_id));

create policy "Teachers can view decisions in their sections"
  on public.student_decisions for select
  using (public.teacher_owns_character_section(character_id));

create policy "Students can create decisions for own character"
  on public.student_decisions for insert
  with check (public.student_owns_character(character_id));

-- ============================================================
-- RLS: grades
-- ============================================================

create policy "Students can view own grades"
  on public.grades for select
  using (public.student_owns_character(character_id));

create policy "Teachers can view grades in their sections"
  on public.grades for select
  using (public.teacher_owns_character_section(character_id));

create policy "Auto-grades can be created for own character"
  on public.grades for insert
  with check (public.student_owns_character(character_id));

create policy "Teachers can create grades in their sections"
  on public.grades for insert
  with check (public.teacher_owns_character_section(character_id));

create policy "Teachers can update grades in their sections"
  on public.grades for update
  using (public.teacher_owns_character_section(character_id))
  with check (public.teacher_owns_character_section(character_id));

-- ============================================================
-- RPC: join section by class code
-- ============================================================

create or replace function public.join_section_by_code(p_class_code text)
returns uuid
language plpgsql security definer
as $$
declare
  v_section_id   uuid;
  v_enrollment_id uuid;
begin
  if not public.is_student() then
    raise exception 'Only students can join sections';
  end if;

  select id into v_section_id
  from public.sections
  where class_code = p_class_code and is_active = true;

  if v_section_id is null then
    raise exception 'Invalid or inactive class code';
  end if;

  insert into public.enrollments (student_id, section_id, status, join_method)
  values (auth.uid(), v_section_id, 'pending', 'class_code')
  returning id into v_enrollment_id;

  return v_enrollment_id;
end;
$$;

-- ============================================================
-- RPC: join section by invite link token
-- ============================================================

create or replace function public.join_section_by_invite(p_invite_token uuid)
returns uuid
language plpgsql security definer
as $$
declare
  v_section_id   uuid;
  v_enrollment_id uuid;
begin
  if not public.is_student() then
    raise exception 'Only students can join sections';
  end if;

  select id into v_section_id
  from public.sections
  where invite_link_token = p_invite_token and is_active = true;

  if v_section_id is null then
    raise exception 'Invalid or inactive invite link';
  end if;

  insert into public.enrollments (student_id, section_id, status, join_method)
  values (auth.uid(), v_section_id, 'pending', 'invite_link')
  returning id into v_enrollment_id;

  return v_enrollment_id;
end;
$$;
